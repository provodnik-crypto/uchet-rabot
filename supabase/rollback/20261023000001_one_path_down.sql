-- Откат 20261023000001_one_path.sql: вернуть функции как были 22.10.2026 и убрать новые таблицы.
-- ВНИМАНИЕ: работы, внесённые через карточку (в «дни» мастеров), остаются в сменах — это обычные смены.
-- Фото результата и сообщения мастеров удаляются вместе с таблицами (сначала сохраните, если нужны).
begin;
drop function public.add_request_work(bigint, jsonb, bigint);
drop function public.delete_my_work(bigint);
drop function public.admin_set_entry_date(bigint, date);
drop function public.start_planned_work(text, text);
drop function public.send_request_for_review_photos(bigint, text, jsonb);
drop function public.create_master_report(text, jsonb);
drop function public.my_master_reports();
drop function public.mark_my_reports_seen();
drop function public.list_master_reports(boolean);
drop function public.decide_master_report(bigint, text, text, text);
CREATE OR REPLACE FUNCTION public.create_manual_request(p_title text, p_details text DEFAULT NULL::text, p_assignee bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  v_manager boolean := public.is_manager();
  v_busy boolean := false;
  v_store smallint;
  v_id bigint;
  v_number text;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Напишите, что нужно сделать'; end if;
  if length(trim(p_title)) > 200 then raise exception 'Слишком длинно: до 200 знаков, подробности — ниже'; end if;
  if p_assignee is not null and (not v_manager or not exists (
    select 1 from employees where id = p_assignee and is_active and role = 'master')) then
    raise exception 'Назначить может только руководитель — и только мастеру';
  end if;
  if not v_manager then
    perform 1 from employees where id = me for update;
    v_busy := (public.active_request_of(me)).id is not null;
  end if;
  select coalesce(e.store_id, public.default_store_id()) into v_store from employees e where e.id = me;
  v_number := nextval('public.manual_request_seq')::text;
  insert into requests (number, source, store_id, operation, subject, description, registered_at, created_by,
                        status, responsible_id, taken_at, assignee_id, last_activity_at)
  values (v_number, 'manual', v_store, trim(p_title), trim(p_title), nullif(trim(coalesce(p_details, '')), ''),
          (now() at time zone public.app_timezone()), me,
          case when v_manager or v_busy then 'waiting' else 'in_work' end,
          case when v_manager or v_busy then null else me end,
          case when v_manager or v_busy then null else now() end,
          case when v_busy then me else p_assignee end, now())
  returning id into v_id;
  insert into request_events (request_id, kind, author_id, to_status, comment)
  values (v_id, 'create', me, case when v_manager or v_busy then 'waiting' else 'in_work' end, 'Заявка № ' || v_number);
  if not v_manager and not v_busy then
    insert into request_events (request_id, kind, author_id, from_status, to_status) values (v_id, 'take', me, 'waiting', 'in_work');
  elsif v_busy then
    insert into request_events (request_id, kind, author_id, comment)
    values (v_id, 'assign', me, 'Назначена себе: возьмёте после текущей заявки');
  elsif p_assignee is not null then
    insert into request_events (request_id, kind, author_id, comment)
    values (v_id, 'assign', me, 'Назначена: ' || (select display_name from employees where id = p_assignee));
  end if;
  return jsonb_build_object('id', v_id, 'number', v_number, 'queued', v_busy);
end $function$

;
CREATE OR REPLACE FUNCTION public.submit_shift(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  v_num text;
  v_req bigint;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if not public.is_manager() then
    for v_num in
      select distinct upper(trim(x ->> 'request_number'))
      from jsonb_array_elements(coalesce(payload -> 'entries', '[]')) x
      where nullif(trim(x ->> 'request_number'), '') is not null
    loop
      if not public.valid_request_number(v_num) then raise exception 'Номер заявки % в неверном формате', v_num; end if;
      insert into requests (number, created_by) values (v_num, me) on conflict (number) do nothing;
      select id into v_req from requests where number = v_num;
      perform public.claim_request_for_work(v_req, me);
    end loop;
  end if;
  return public.submit_shift_core(payload);
end $function$

;
CREATE OR REPLACE FUNCTION public.save_shift_requests(p_shift bigint, p_requests jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item   jsonb;
  v_num    text;
  v_req    bigint;
  v_min    integer;
  v_author bigint := (select author_id from shifts where id = p_shift);
  v_total  integer := 0;
begin
  if p_requests is null then return; end if;
  if jsonb_typeof(p_requests) <> 'array' then raise exception 'Неверные данные времени'; end if;
  delete from shift_requests where shift_id = p_shift;
  for v_item in select * from jsonb_array_elements(p_requests) loop
    v_num := upper(nullif(trim(v_item ->> 'request_number'), ''));
    if (v_item ->> 'minutes') !~ '^\d+$' then raise exception 'Время: укажите количество минут'; end if;
    v_min := (v_item ->> 'minutes')::int;
    if v_min > 1440 or v_min % 15 <> 0 then raise exception 'Время: от 0 до 24 ч с шагом 15 минут'; end if;
    v_total := v_total + v_min;
    if v_num is null then
      v_req := null;
    else
      if not public.valid_request_number(v_num) then raise exception 'Номер заявки % в неверном формате', v_num; end if;
      insert into requests (number, created_by) values (v_num, v_author) on conflict (number) do nothing;
      select id into v_req from requests where number = v_num;
      if v_min > 0 and not public.is_manager() then perform public.claim_request_for_work(v_req, v_author); end if;
      if v_min > 0 then update requests set last_activity_at = now() where id = v_req; end if;
    end if;
    if exists (select 1 from shift_requests where shift_id = p_shift and coalesce(request_id, 0) = coalesce(v_req, 0)) then
      raise exception 'Заявка % указана в смене дважды', coalesce(v_num, '«без заявки»');
    end if;
    insert into shift_requests (shift_id, request_id, minutes, status)
    values (p_shift, v_req, v_min, case when v_req is null then null else 'done' end);
  end loop;
  if v_total > 1440 then raise exception 'Время за смену больше 24 часов'; end if;
end $function$

;
CREATE OR REPLACE FUNCTION public.photo_cleanup_batch(p_limit integer DEFAULT 200)
 RETURNS TABLE(path text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
    select t.path from photo_trash t
    where not exists (select 1 from entry_photos p where p.path = t.path or p.thumb_path = t.path)
    limit greatest(p_limit, 1);
  if to_regclass('storage.objects') is not null then
    return query execute
      'select o.name from storage.objects o
       where o.bucket_id = ''work-photos'' and o.created_at < now() - interval ''1 day''
         and not exists (select 1 from public.entry_photos p where p.path = o.name or p.thumb_path = o.name)
       limit $1' using greatest(p_limit, 1);
  end if;
end $function$

;
CREATE OR REPLACE FUNCTION public.request_card(p_id bigint DEFAULT NULL::bigint, p_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  r requests;
begin
  if me is null then raise exception 'Нет доступа'; end if;
  select * into r from requests x where (p_id is not null and x.id = p_id) or (p_id is null and x.number = p_number);
  if not found then return null; end if;
  return jsonb_build_object(
    'id', r.id, 'number', r.number, 'source', r.source, 'subject', r.subject,
    'service', r.service, 'operation', r.operation, 'description', r.description,
    'registered_at', r.registered_at, 'due_at', r.due_at, 'requester_name', public.requester_short(r.requester),
    'is_open', r.is_open, 'state', r.state, 'to_contractor', r.to_contractor,
    'assignee_id', r.assignee_id, 'mine', coalesce(r.assignee_id = me, false),
    'assignee_name', (select e.display_name from employees e where e.id = r.assignee_id),
    'status', r.status, 'priority', r.priority, 'plan_minutes', r.plan_minutes,
    'responsible_id', r.responsible_id,
    'responsible_name', (select e.display_name from employees e where e.id = r.responsible_id),
    'is_responsible', coalesce(r.responsible_id = me, false),
    'taken_at', r.taken_at, 'hold_reason', r.hold_reason, 'paused_at', r.paused_at,
    'hold_number', (select h.number from requests h where h.id = r.hold_for),
    'pause_request', r.pause_request, 'pause_requested_at', r.pause_requested_at,
    'my_active', (select jsonb_build_object('id', a.id, 'number', a.number) from requests a
                  where a.responsible_id = me and a.status = 'in_work' and a.is_open limit 1), 'sent_at', r.sent_at, 'returned_comment', r.returned_comment,
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.display_name) order by e.display_name)
                         from request_members m join employees e on e.id = m.employee_id where m.request_id = r.id), '[]'::jsonb),
    'spent_minutes', (select coalesce(sum(x.minutes), 0) from shift_requests x where x.request_id = r.id),
    'time_by_day', coalesce((select jsonb_agg(jsonb_build_object('work_date', s.work_date, 'shift_uuid', s.client_uuid, 'minutes', x.minutes, 'author', e.display_name)
                                              order by s.work_date)
                             from shift_requests x join shifts s on s.id = x.shift_id join employees e on e.id = s.author_id
                             where x.request_id = r.id and x.minutes > 0), '[]'::jsonb),
    'works', coalesce((
      select jsonb_agg(jsonb_build_object(
               'work_date', s.work_date,
               'shift_uuid', s.client_uuid, 'name', coalesce(p.short_name, w.custom_name),
               'quantity', w.quantity, 'unit', u.code, 'status', w.status,
               'performers', (select string_agg(e.display_name, ', ' order by ep.position)
                              from entry_performers ep join employees e on e.id = ep.employee_id
                              where ep.entry_id = w.id))
             order by s.work_date desc, w.position)
      from work_entries w
      join shifts s on s.id = w.shift_id
      join units u on u.id = w.unit_id
      left join price_items p on p.id = w.price_item_id
      where w.request_id = r.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', ev.id, 'edited', ev.edited_at is not null, 'deleted', ev.deleted_at is not null,
                                          'kind', ev.kind, 'at', ev.created_at, 'from', ev.from_status, 'to', ev.to_status,
                                          'comment', ev.comment, 'mine', ev.author_id = me,
                                          'author', case when e.role = 'manager' then 'Руководитель' else e.display_name end)
                       order by ev.created_at desc, ev.id desc)
      from request_events ev left join employees e on e.id = ev.author_id
      where ev.request_id = r.id), '[]'::jsonb)
  );
end $function$

;
CREATE OR REPLACE FUNCTION public.my_notifications()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  v_store smallint;
begin
  if me is null then raise exception 'Нет доступа'; end if;
  if public.is_manager() then
    return jsonb_build_object(
      'unread', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
          select jsonb_build_object('id', r.id, 'number', r.number, 'count', u.n, 'at', r.last_activity_at,
                   'refused', exists (select 1 from request_events ev where ev.request_id = r.id and ev.kind = 'refuse'
                                      and ev.created_at > coalesce((select rr.read_at from request_reads rr where rr.request_id = r.id and rr.employee_id = me), '-infinity'))) x
          from requests r cross join lateral (select public.request_unread(r.id, me, true) n) u
          where u.n > 0 and r.last_activity_at > now() - interval '60 days'
          order by r.last_activity_at desc limit 20) t), '[]'::jsonb),
      'pause_requests', (select count(*)::int from requests r where r.pause_request is not null and r.is_open),
      'stale', (select count(*)::int from requests r where r.status = 'in_work' and r.is_open
                and public.request_work_days(r.taken_at) > public.stale_work_days()),
      'stale_days', public.stale_work_days()
    );
  end if;
  select coalesce(e.store_id, public.default_store_id()) into v_store from employees e where e.id = me;
  return jsonb_build_object(
    'unread', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'count', u.n) order by r.last_activity_at desc)
        from requests r cross join lateral (select public.request_unread(r.id, me, false) n) u
        where u.n > 0 and r.is_open and r.status <> 'accepted'
          and (r.responsible_id = me or r.assignee_id = me
               or exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = me))), '[]'::jsonb),
    'returned', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'comment', r.returned_comment, 'queued', r.status = 'paused'))
        from requests r where r.status in ('in_work', 'paused') and r.responsible_id = me and r.returned_comment is not null and r.is_open), '[]'::jsonb),
    'urgent', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'operation', r.operation, 'status', r.status)
                                         order by r.registered_at desc)
        from requests r where r.is_open and r.priority = 1
          and (r.status = 'waiting' and r.store_id = v_store and (r.assignee_id is null or r.assignee_id = me)
               or r.status = 'in_work' and r.responsible_id = me)), '[]'::jsonb)
  );
end $function$

;
drop function public.report_photos(bigint);
drop function public.insert_work_entry(shifts, bigint, jsonb);
drop function public.my_editable_entry(bigint);
drop function public.day_shift(bigint, date);
drop function public.day_shift_uuid(bigint, date);
drop function public.attach_extra_photos(text, bigint, jsonb, integer);
drop table public.master_reports;
drop table public.extra_photos;
alter table public.requests drop column is_planned;
commit;
notify pgrst, 'reload schema';
