-- Фото из файла ITSM (столбец «Фото») и рабочий телефон инициатора (031xxx), 02.11.2026. Только добавляет.
--  * Фото заявки — extra_photos с owner_kind = 'request' (ночная чистка их уже учитывает). Загружает руководитель
--    с телефона (файл разбирается там же), видят все сотрудники — мастеру нужно понять, что и где сделать.
--  * Рабочий телефон — requests.contact_phone «031899» или «031899, 031900» (решение заказчика: только 031xxx).

alter table public.extra_photos drop constraint extra_photos_owner_kind_check;
alter table public.extra_photos add constraint extra_photos_owner_kind_check check (owner_kind in ('result', 'report', 'request'));

alter table public.requests add column contact_phone text
  check (contact_phone is null or contact_phone ~ '^031\d{3}(, 031\d{3}){0,2}$');
grant select (contact_phone) on public.requests to authenticated;

/** Фото заявки из файла: только если у заявки фото ещё нет (повторная загрузка файла не дублирует). Вернёт, сколько записано. */
create function public.attach_request_photos(p_number text, p_photos jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public.require_manager();
  select id into v_id from requests where number = p_number for update;
  if v_id is null then raise exception 'Заявка % не найдена', p_number; end if;
  if exists (select 1 from extra_photos where owner_kind = 'request' and owner_id = v_id) then return 0; end if;
  perform public.attach_extra_photos('request', v_id, coalesce(p_photos, '[]'::jsonb), 1);
  return (select count(*) from extra_photos where owner_kind = 'request' and owner_id = v_id);
end $$;
revoke all on function public.attach_request_photos(text, jsonb) from public, anon;
grant execute on function public.attach_request_photos(text, jsonb) to authenticated;

/** Номера заявок из файла, у которых фото уже есть — чтобы не загружать их снова. */
create function public.requests_with_photos(p_numbers text[]) returns text[]
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return coalesce((select array_agg(r.number) from requests r
    where r.number = any (p_numbers) and exists (select 1 from extra_photos x where x.owner_kind = 'request' and x.owner_id = r.id)), '{}');
end $$;
revoke all on function public.requests_with_photos(text[]) from public, anon;
grant execute on function public.requests_with_photos(text[]) to authenticated;

/** Рабочие телефоны из файла [{number, phone}]: записываются, если у заявки телефона ещё нет. */
create function public.set_request_phones(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_manager();
  if jsonb_typeof(p) is distinct from 'array' then return 0; end if;
  update requests r set contact_phone = x ->> 'phone'
  from jsonb_array_elements(p) x
  where r.number = x ->> 'number' and r.source = 'itsm' and r.contact_phone is null
    and coalesce(x ->> 'phone', '') ~ '^031\d{3}(, 031\d{3}){0,2}$';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_request_phones(jsonb) from public, anon;
grant execute on function public.set_request_phones(jsonb) to authenticated;

/** Карточка заявки: фото из файла и рабочий телефон инициатора (мастеру и руководителю). */
create function public.request_extras(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_employee_id() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (select jsonb_build_object(
      'contact_phone', r.contact_phone,
      'photos', coalesce((select jsonb_agg(jsonb_build_object('path', x.path, 'thumb_path', x.thumb_path) order by x.position)
                          from extra_photos x where x.owner_kind = 'request' and x.owner_id = r.id), '[]'::jsonb))
    from requests r where r.id = p_id);
end $$;
revoke all on function public.request_extras(bigint) from public, anon;
grant execute on function public.request_extras(bigint) to authenticated;

/** Для значка 📷 в списке: открытые заявки с фото. */
create function public.request_photo_ids() returns bigint[]
language sql stable security definer set search_path = public as $$
  select case when public.current_employee_id() is null then '{}'::bigint[] else
    coalesce((select array_agg(distinct x.owner_id) from extra_photos x join requests r on r.id = x.owner_id
              where x.owner_kind = 'request' and r.is_open), '{}') end
$$;
revoke all on function public.request_photo_ids() from public, anon;
grant execute on function public.request_photo_ids() to authenticated;

-- Файлы фото: фото заявки видят все сотрудники, остальные доп. фото — как раньше, только руководитель.
create or replace function public.can_see_extra_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.is_manager() and exists (select 1 from extra_photos x where x.path = p_name or x.thumb_path = p_name))
      or (public.current_employee_id() is not null
          and exists (select 1 from extra_photos x where x.owner_kind = 'request' and (x.path = p_name or x.thumb_path = p_name)))
$$;
