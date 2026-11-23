-- «Безопасность» (23.11.2026): у инициатора вместо кнопки «Срочно» —
-- «Срочно. Заявка связана с безопасностью». Такой заявке ставится requests.safety = true,
-- МВСО видит метку «Безопасность» в списке заявок, в карточке и на проверке.
-- Столбец только добавляется; старые сборки работают как раньше (p_safety по умолчанию false).
-- Откат: supabase/rollback/20261124000003_safety_down.sql
alter table public.requests add column if not exists safety boolean not null default false;
comment on column public.requests.safety is 'Заявка связана с безопасностью (кнопка «Срочно. Заявка связана с безопасностью» у инициатора)';
grant select (safety) on public.requests to authenticated;

-- ---------- create_initiator_request: версия с p_safety (старая, без него, остаётся для старых сборок) ----------
create or replace function public.create_initiator_request(
  p_category text, p_description text, p_department_id smallint, p_place text,
  p_due date default null, p_urgent boolean default false, p_urgent_reason text default null,
  p_materials text default null, p_photos jsonb default '[]'::jsonb,
  p_safety boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_initiator_id();
  v_cat text := trim(coalesce(p_category, ''));
  v_desc text; v_place text; v_mat text; v_reason text;
  v_store smallint; v_dept smallint; v_id bigint; v_number text;
  v_has_storage boolean := to_regclass('storage.objects') is not null;
  v_found boolean; v_folder text; ph jsonb; v_n int := 0;
  v_pen_id bigint; v_pen_number text;
  v_categories text[] := array['Демонтаж', 'Замена', 'Ремонт', 'Оклейка', 'Размещение', 'Покраска', 'Сборка', 'Другое'];
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  -- шлюз: сначала оцените выполненную заявку
  select r.id, r.number into v_pen_id, v_pen_number
    from requests r
    where r.created_by = me and r.status = 'accepted'
      and not exists (select 1 from request_ratings g where g.request_id = r.id)
    order by r.registered_at asc limit 1;
  if v_pen_id is not null then raise exception 'Сначала оцените заявку № %', v_pen_number; end if;
  if not (v_cat = any (v_categories)) then raise exception 'Выберите, что нужно сделать'; end if;
  v_desc := trim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g'));
  if length(v_desc) < 3 then raise exception 'Опишите задачу'; end if;
  if length(v_desc) > 200 then raise exception 'Слишком длинно: до 200 знаков'; end if;
  perform public.assert_clean_text(v_desc, 'В описании');
  select id into v_dept from departments
    where id = coalesce(p_department_id, (select department_id from employees where id = me)) and is_active;
  if v_dept is null then raise exception 'Выберите отдел'; end if;
  v_place := nullif(trim(regexp_replace(coalesce(p_place, ''), '\s+', ' ', 'g')), '');
  if v_place is null then raise exception 'Укажите место проведения работ (аллея, подиум, бокс)'; end if;
  perform public.assert_clean_text(v_place, 'В месте проведения работ');
  v_mat := nullif(trim(regexp_replace(coalesce(p_materials, ''), '\s+', ' ', 'g')), '');
  if length(coalesce(v_mat, '')) > 300 then raise exception 'Материалы: до 300 знаков'; end if;
  perform public.assert_clean_text(v_mat, 'В материалах');
  if p_urgent then
    v_reason := nullif(trim(regexp_replace(coalesce(p_urgent_reason, ''), '\s+', ' ', 'g')), '');
    if v_reason is null then raise exception 'Укажите, почему это срочно'; end if;
    if length(v_reason) > 200 then raise exception 'Причина срочности: до 200 знаков'; end if;
    perform public.assert_clean_text(v_reason, 'В причине срочности');
  end if;
  -- фото: обязательно 1–3, загружены приложением в папку вызывающего (как у всех)
  if coalesce(jsonb_array_length(p_photos), 0) < 1 then raise exception 'Добавьте фото (минимум 1)'; end if;
  if jsonb_array_length(p_photos) > 3 then raise exception 'Не больше 3 фото'; end if;
  v_folder := auth.uid()::text || '/';
  for ph in select * from jsonb_array_elements(p_photos) loop
    if coalesce(ph ->> 'path', '') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
       or coalesce(ph ->> 'thumb_path', '') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}_t\.jpg$'
       or left(ph ->> 'path', length(v_folder)) <> v_folder
       or left(ph ->> 'thumb_path', length(v_folder)) <> v_folder then
      raise exception 'Фото не найдено' using errcode = '42501';
    end if;
    if v_has_storage then
      execute 'select exists (select 1 from storage.objects where bucket_id = ''work-photos'' and name = $1)'
        into v_found using ph ->> 'path';
      if not v_found then raise exception 'Фото ещё не загружено, нажмите «Повторить»'; end if;
    end if;
  end loop;
  select coalesce(store_id, public.default_store_id()) into v_store from employees where id = me;
  v_number := nextval('public.manual_request_seq')::text;
  insert into requests (number, source, store_id, operation, subject, description, registered_at, created_by,
                        status, priority, due_at, department_id, place, materials, urgent_reason, safety, last_activity_at)
  values (v_number, 'initiator', v_store, v_cat, v_desc, null,
          (now() at time zone public.app_timezone()), me, 'waiting',
          case when p_urgent then 1 else 3 end,
          p_due::timestamp, v_dept, v_place, v_mat, case when p_urgent then v_reason end,
          coalesce(p_safety, false), now())
  returning id into v_id;
  v_n := 0;
  for ph in select * from jsonb_array_elements(p_photos) loop
    v_n := v_n + 1;
    insert into extra_photos (owner_kind, owner_id, position, path, thumb_path, width, height, size_bytes, uploaded_by)
    values ('request', v_id, v_n, ph ->> 'path', ph ->> 'thumb_path',
            nullif(ph ->> 'width', '')::int, nullif(ph ->> 'height', '')::int, nullif(ph ->> 'size_bytes', '')::int, me)
    on conflict (path) do nothing;
    delete from photo_trash where path in (ph ->> 'path', ph ->> 'thumb_path');
  end loop;
  insert into request_events (request_id, kind, author_id, to_status, comment)
  values (v_id, 'create', me, 'waiting', 'Заявка № ' || v_number);
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;
revoke all on function public.create_initiator_request(text, text, smallint, text, date, boolean, text, text, jsonb, boolean) from public, anon;
grant execute on function public.create_initiator_request(text, text, smallint, text, date, boolean, text, text, jsonb, boolean) to authenticated;

-- ---------- Метка «Безопасность» МВСО: список заявок, карточка, данные заявки из магазина ----------
do $$
declare
  d text; n text; f text;
  pairs text[][] := array[
    -- list_requests: столбец safety в выдаче и в select
    array['public.list_requests(text, integer, text, text, smallint, bigint)',
          'pause_request text, pause_requested_at timestamp with time zone, work_days integer)',
          'pause_request text, pause_requested_at timestamp with time zone, work_days integer, safety boolean)'],
    array['public.list_requests(text, integer, text, text, smallint, bigint)',
          E'case when r.status = ''in_work'' then public.request_work_days(r.taken_at) end\n    from requests r',
          E'case when r.status = ''in_work'' then public.request_work_days(r.taken_at) end, r.safety\n    from requests r'],
    -- request_card: ключ safety
    array['public.request_card(bigint, text)',
          $r$'status', r.status, 'priority', r.priority,$r$,
          $r$'status', r.status, 'priority', r.priority, 'safety', r.safety,$r$],
    -- request_extra_fields: ключ safety (блок «Заявка из магазина»)
    array['public.request_extra_fields(bigint)',
          $r$'urgent_reason', r.urgent_reason,$r$,
          $r$'urgent_reason', r.urgent_reason, 'safety', r.safety,$r$]
  ];
  i int;
  defs jsonb := '{}';
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := coalesce(defs ->> f, pg_get_functiondef(f::regprocedure));
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][2], f; end if;
    defs := defs || jsonb_build_object(f, n);
  end loop;
  for f in select jsonb_object_keys(defs) loop
    if f = 'public.list_requests(text, integer, text, text, smallint, bigint)' then
      -- состав столбцов выдачи меняется — только пересоздание
      execute 'drop function ' || f;
      execute defs ->> f;
      execute format('revoke all on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    else
      execute defs ->> f;
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
