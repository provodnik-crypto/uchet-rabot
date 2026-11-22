-- Откат этапа «Оценки» (22.11.2026). Точка восстановления данных: backups/db_backup_2026-11-22_initiators.json.gz.

-- ---------- Функции: как до этапа ----------
create or replace function public.create_initiator_request(
  p_category text, p_description text, p_department_id smallint, p_place text,
  p_due date default null, p_urgent boolean default false, p_urgent_reason text default null,
  p_materials text default null, p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_initiator_id();
  v_cat text := trim(coalesce(p_category, ''));
  v_desc text; v_place text; v_mat text; v_reason text;
  v_store smallint; v_dept smallint; v_id bigint; v_number text;
  v_has_storage boolean := to_regclass('storage.objects') is not null;
  v_found boolean; v_folder text; ph jsonb; v_n int := 0;
  v_categories text[] := array['Демонтаж', 'Замена', 'Ремонт', 'Оклейка', 'Размещение', 'Покраска', 'Сборка', 'Другое'];
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  -- (шлюз оценки «сначала оцените выполненную» добавит миграция части 2 — вместе с окном оценки)
  if not (v_cat = any (v_categories)) then raise exception 'Выберите, что нужно сделать'; end if;
  v_desc := trim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g'));
  if length(v_desc) < 3 then raise exception 'Опишите задачу'; end if;
  if length(v_desc) > 200 then raise exception 'Слишком длинно: до 200 знаков'; end if;
  perform public.assert_clean_text(v_desc, 'В описании');
  select id into v_dept from departments
    where id = coalesce(p_department_id, (select department_id from employees where id = me)) and is_active;
  if v_dept is null then raise exception 'Выберите отдел'; end if;
  v_place := nullif(trim(regexp_replace(coalesce(p_place, ''), '\s+', ' ', 'g')), '');
  if v_place is null then raise exception 'Укажите, где именно (аллея, подиум, бокс)'; end if;
  perform public.assert_clean_text(v_place, 'В поле «где»');
  v_mat := nullif(trim(regexp_replace(coalesce(p_materials, ''), '\s+', ' ', 'g')), '');
  if length(coalesce(v_mat, '')) > 300 then raise exception 'Материалы: до 300 знаков'; end if;
  perform public.assert_clean_text(v_mat, 'В материалах');
  if p_urgent then
    v_reason := nullif(trim(regexp_replace(coalesce(p_urgent_reason, ''), '\s+', ' ', 'g')), '');
    if v_reason is null then raise exception 'Укажите, почему это срочно'; end if;
    if length(v_reason) > 200 then raise exception 'Причина срочности: до 200 знаков'; end if;
    perform public.assert_clean_text(v_reason, 'В причине срочности');
  end if;
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
                        status, priority, due_at, department_id, place, materials, urgent_reason, last_activity_at)
  values (v_number, 'initiator', v_store, v_cat, v_desc, null,
          (now() at time zone public.app_timezone()), me, 'waiting',
          case when p_urgent then 1 else 3 end,
          p_due::timestamp, v_dept, v_place, v_mat, case when p_urgent then v_reason end, now())
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
revoke all on function public.create_initiator_request(text, text, smallint, text, date, boolean, text, text, jsonb) from public, anon;
grant execute on function public.create_initiator_request(text, text, smallint, text, date, boolean, text, text, jsonb) to authenticated;

create or replace function public.initiator_request_card(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'id', r.id, 'number', r.number, 'subject', r.subject, 'operation', r.operation,
      'status', r.status, 'priority', r.priority, 'place', r.place, 'materials', r.materials,
      'urgent_reason', r.urgent_reason, 'due_at', r.due_at, 'registered_at', r.registered_at,
      'creator_name', cr.display_name, 'master_name', m.display_name, 'department_name', d.name,
      'can_cancel', r.is_open and r.status = 'waiting' and r.created_by = me,
      'photos', coalesce((select jsonb_agg(jsonb_build_object('path', x.path, 'thumb_path', x.thumb_path) order by x.position)
                          from extra_photos x where x.owner_kind = 'request' and x.owner_id = r.id), '[]'::jsonb))
    from requests r
    left join employees cr on cr.id = r.created_by
    left join employees m on m.id = r.assignee_id
    left join departments d on d.id = r.department_id
    where r.id = p_id
      and (r.created_by = me
           or exists (select 1 from employees e where e.id = me and e.department_id is not null
                      and r.department_id = e.department_id)));
end $$;
revoke all on function public.initiator_request_card(bigint) from public, anon;
grant execute on function public.initiator_request_card(bigint) to authenticated;

create or replace function public.request_initiator_info(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'creator_name', cr.display_name, 'creator_grade', cr.grade,
      'creator_work_phone', cr.work_phone, 'creator_mobile', c.mobile,
      'department_name', d.name, 'place', r.place, 'materials', r.materials,
      'urgent_reason', r.urgent_reason)
    from requests r
    left join employees cr on cr.id = r.created_by
    left join initiator_contacts c on c.employee_id = cr.id
    left join departments d on d.id = r.department_id
    where r.id = p_id);
end $$;
revoke all on function public.request_initiator_info(bigint) from public, anon;
grant execute on function public.request_initiator_info(bigint) to authenticated;

drop function if exists
  public.initiator_pending_ratings(),
  public.submit_initiator_rating(bigint, smallint, text);

-- ---------- Таблица ----------
drop table if exists public.request_ratings;
