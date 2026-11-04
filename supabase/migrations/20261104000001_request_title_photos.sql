-- Название заявки и фото к заявке (04.11.2026). Только добавляет; откат — supabase/rollback/20261104000001_request_title_photos_down.sql
--  * set_request_title — изменить название (requests.operation — то, что видят в списках и карточке).
--    Руководитель — у любой заявки; мастер — у заявки, которую создал сам («Работа без заявки»), пока она не на проверке.
--    Кто и когда изменил — requests.title_edited_by / title_edited_at (экрана истории нет).
--    Повторная загрузка файла ITSM сопоставляет заявки по номеру и существующие строки не меняет (кроме срока) —
--    изменённое название не перезаписывается (проверено тестом 34).
--  * add_request_photos — добавить фото к заявке (к уже имеющимся): руководитель — к любой, мастер — к своей «В работе».
--  * delete_request_photo — удалить фото заявки: загрузивший или руководитель.
--  * request_extras: id фото, can_delete, can_add; request_card: can_edit_title, title_edited_at.

alter table public.requests add column title_edited_by bigint references public.employees (id);
alter table public.requests add column title_edited_at timestamptz;

/** Может ли текущий сотрудник менять название заявки. */
create function public.can_edit_request_title(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_employee_id() is not null and (
    (public.is_manager() and exists (select 1 from requests where id = p_id))
    or exists (select 1 from requests r where r.id = p_id and r.created_by = public.current_employee_id()
               and r.is_open and r.status in ('waiting', 'in_work', 'paused')))
$$;

create function public.set_request_title(p_id bigint, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  t text := trim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  r requests;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if t = '' then raise exception 'Название не может быть пустым'; end if;
  if length(t) > 200 then raise exception 'Слишком длинно: до 200 знаков'; end if;
  select * into r from requests where id = p_id for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if not public.can_edit_request_title(p_id) then
    raise exception 'Название меняет руководитель. Мастер — только у своей заявки, пока она не отправлена на проверку.' using errcode = '42501';
  end if;
  if r.operation is not distinct from t then return; end if;
  -- subject у ручной заявки — то же название; у ITSM — тема «для себя» руководителя, её не трогаем, если он её менял
  update requests set operation = t,
         subject = case when source = 'manual' or subject is null or subject is not distinct from r.operation then t else subject end,
         title_edited_by = me, title_edited_at = now()
  where id = p_id;
end $$;

/** Добавить фото к заявке (к уже имеющимся, до 3 за раз, всего до 12). */
create function public.add_request_photos(p_id bigint, p_photos jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  r requests;
  n int;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select * into r from requests where id = p_id for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if not public.is_manager() and not (r.responsible_id = me and r.status = 'in_work' and r.is_open) then
    raise exception 'Добавить фото может руководитель или мастер, у которого заявка в работе' using errcode = '42501';
  end if;
  select count(*) into n from extra_photos where owner_kind = 'request' and owner_id = p_id;
  if n + (case when jsonb_typeof(p_photos) = 'array' then jsonb_array_length(p_photos) else 0 end) > 12 then
    raise exception 'У заявки не больше 12 фото — удалите лишние';
  end if;
  perform public.attach_extra_photos('request', p_id, coalesce(p_photos, '[]'::jsonb), 1);
  update requests set last_activity_at = now() where id = p_id;
  return (select count(*) from extra_photos where owner_kind = 'request' and owner_id = p_id);
end $$;

/** Удалить фото заявки: загрузивший или руководитель. Файл уберёт ночная чистка. */
create function public.delete_request_photo(p_photo_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  x extra_photos;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select * into x from extra_photos where id = p_photo_id and owner_kind = 'request' for update;
  if not found then raise exception 'Фото уже удалено'; end if;
  if not public.is_manager() and x.uploaded_by is distinct from me then
    raise exception 'Удалить фото может тот, кто его добавил, или руководитель' using errcode = '42501';
  end if;
  delete from extra_photos where id = x.id;
  insert into photo_trash (path) values (x.path), (x.thumb_path) on conflict do nothing;
end $$;

/** Карточка заявки: фото (с правом удалить), право добавить, рабочий телефон инициатора. */
create or replace function public.request_extras(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_manager boolean := public.is_manager();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (select jsonb_build_object(
      'contact_phone', r.contact_phone,
      'can_add', v_manager or (r.responsible_id = me and r.status = 'in_work' and r.is_open),
      'photos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'path', x.path, 'thumb_path', x.thumb_path,
                                                              'can_delete', v_manager or x.uploaded_by = me) order by x.position)
                          from extra_photos x where x.owner_kind = 'request' and x.owner_id = r.id), '[]'::jsonb))
    from requests r where r.id = p_id);
end $$;

do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.request_card(bigint,text)'::regprocedure);
  n := replace(d, $r$'taken_at', r.taken_at, 'is_planned', r.is_planned,$r$,
               $r$'taken_at', r.taken_at, 'is_planned', r.is_planned,
    'can_edit_title', public.can_edit_request_title(r.id), 'title_edited_at', r.title_edited_at,$r$);
  if n = d then raise exception 'request_card: не нашёл место для can_edit_title'; end if;
  execute n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.can_edit_request_title(bigint)', 'public.set_request_title(bigint, text)',
                           'public.add_request_photos(bigint, jsonb)', 'public.delete_request_photo(bigint)',
                           'public.request_extras(bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
