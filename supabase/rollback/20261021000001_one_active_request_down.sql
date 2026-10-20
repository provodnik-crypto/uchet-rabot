-- Откат 20261021000001_one_active_request.sql: снова без правила «одна заявка в работе».
-- Приостановленные заявки возвращаются «В работе» у того же мастера. Функции — как были до 21.10.2026.
begin;
drop index if exists public.requests_one_active_uq;
update public.requests set status = 'in_work', hold_reason = null, hold_for = null, paused_at = null where status = 'paused';
update public.requests set pause_request = null, pause_requested_at = null;
alter table public.requests drop constraint requests_hold_check;
alter table public.requests drop constraint requests_pause_request_check;
alter table public.requests drop constraint requests_status_check;
alter table public.requests add constraint requests_status_check
  check (status = any (array['waiting', 'in_work', 'review', 'accepted', 'contractor']));
alter table public.requests drop constraint requests_responsible_status;
alter table public.requests add constraint requests_responsible_status
  check (status = 'accepted' or ((status = any (array['in_work', 'review'])) = (responsible_id is not null)));
-- события «приостановка/продолжение» остаются в истории; список видов не сужаем
drop function public.request_pause(bigint, text);
drop function public.decide_pause(bigint, boolean, text);
drop function public.resume_request(bigint);
drop function public.masters_now();
drop function public.my_requests();
drop function public.list_requests(text, integer, text, text, smallint, bigint);
CREATE OR REPLACE FUNCTION public.take_request(p_id bigint, p_plan_minutes integer, p_member_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  r requests;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if p_plan_minutes is not null and (p_plan_minutes < 15 or p_plan_minutes > 100000) then
    raise exception 'Примерное время: от 15 минут';
  end if;
  update requests set status = 'in_work', responsible_id = me, taken_at = now(),
                      plan_minutes = coalesce(p_plan_minutes, plan_minutes), returned_comment = null
  where id = p_id and status = 'waiting' and is_open and not to_contractor
    and (assignee_id is null or assignee_id = me)
  returning * into r;
  if r.id is null then
    select * into r from requests where id = p_id;
    if r.id is null then raise exception 'Заявка не найдена'; end if;
    if not r.is_open then raise exception 'Заявка закрыта'; end if;
    if r.status = 'contractor' or r.to_contractor then raise exception 'Заявка у подрядчика'; end if;
    if r.responsible_id = me then raise exception 'Заявка уже у вас в работе'; end if;
    if r.responsible_id is not null then
      raise exception 'Заявку уже взял %', (select display_name from employees where id = r.responsible_id);
    end if;
    if r.assignee_id is not null then
      raise exception 'Заявка назначена: %', (select display_name from employees where id = r.assignee_id);
    end if;
    raise exception 'Заявку сейчас нельзя взять';
  end if;
  delete from request_members where request_id = p_id;
  insert into request_members (request_id, employee_id)
  select p_id, e.id from employees e
  where e.id = any (coalesce(p_member_ids, '{}')) and e.id <> me and e.is_active and e.role = 'master';
  perform public.log_request_event(p_id, 'take', 'waiting', 'in_work',
    case when p_plan_minutes is not null then 'Примерно: ' || public.minutes_label(p_plan_minutes) end);
end $function$

;
CREATE OR REPLACE FUNCTION public.claim_request_for_work(p_request bigint, p_author bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r requests;
begin
  select * into r from requests where id = p_request for update;
  if r.status = 'waiting' then
    if r.to_contractor then raise exception 'Заявка % у подрядчика', r.number; end if;
    if r.assignee_id is not null and r.assignee_id <> p_author then
      raise exception 'Заявка % назначена: %', r.number, (select display_name from employees where id = r.assignee_id);
    end if;
    update requests set status = 'in_work', responsible_id = p_author, taken_at = now(), returned_comment = null
    where id = p_request;
    insert into request_events (request_id, kind, author_id, from_status, to_status)
    values (p_request, 'take', p_author, 'waiting', 'in_work');
  elsif r.status = 'contractor' then
    raise exception 'Заявка % у подрядчика', r.number;
  elsif r.status in ('in_work', 'review') and r.responsible_id <> p_author then
    -- работы по заявке вносит только взявший её; напарники лишь числятся
    raise exception 'Заявку % взял %', r.number, (select display_name from employees where id = r.responsible_id);
  end if;
  -- accepted и свои in_work/review — без изменений (правка смены в тот же день)
end $function$

;
CREATE OR REPLACE FUNCTION public.create_manual_request(p_title text, p_details text DEFAULT NULL::text, p_assignee bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  v_manager boolean := public.is_manager();
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
  select coalesce(e.store_id, public.default_store_id()) into v_store from employees e where e.id = me;
  v_number := nextval('public.manual_request_seq')::text;
  insert into requests (number, source, store_id, operation, subject, description, registered_at, created_by,
                        status, responsible_id, taken_at, assignee_id, last_activity_at)
  values (v_number, 'manual', v_store, trim(p_title), trim(p_title), nullif(trim(coalesce(p_details, '')), ''),
          (now() at time zone public.app_timezone()), me,
          case when v_manager then 'waiting' else 'in_work' end,
          case when v_manager then null else me end,
          case when v_manager then null else now() end,
          p_assignee, now())
  returning id into v_id;
  insert into request_events (request_id, kind, author_id, to_status, comment)
  values (v_id, 'create', me, case when v_manager then 'waiting' else 'in_work' end, 'Заявка № ' || v_number);
  if not v_manager then
    insert into request_events (request_id, kind, author_id, from_status, to_status) values (v_id, 'take', me, 'waiting', 'in_work');
  elsif p_assignee is not null then
    insert into request_events (request_id, kind, author_id, comment)
    values (v_id, 'assign', me, 'Назначена: ' || (select display_name from employees where id = p_assignee));
  end if;
  return jsonb_build_object('id', v_id, 'number', v_number);
end $function$

;
CREATE OR REPLACE FUNCTION public.send_request_for_review(p_id bigint, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me bigint := public.current_employee_id();
begin
  if not exists (select 1 from requests where id = p_id and status = 'in_work' and responsible_id = me) then
    raise exception 'Отправить может только мастер, который взял заявку';
  end if;
  if not exists (select 1 from work_entries where request_id = p_id and status <> 'rejected')
     and not exists (select 1 from shift_requests where request_id = p_id and minutes > 0) then
    raise exception 'По заявке нет ни работ, ни времени';
  end if;
  update requests set status = 'review', sent_at = now(), returned_comment = null where id = p_id;
  perform public.log_request_event(p_id, 'send', 'in_work', 'review', p_comment);
end $function$

;
CREATE OR REPLACE FUNCTION public.refuse_request(p_id bigint, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me bigint := public.current_employee_id();
begin
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, почему отказываетесь'; end if;
  update requests set status = 'waiting', responsible_id = null, taken_at = null, returned_comment = null
  where id = p_id and status = 'in_work' and responsible_id = me;
  if not found then raise exception 'Отказаться может только мастер, который взял заявку'; end if;
  delete from request_members where request_id = p_id;
  perform public.log_request_event(p_id, 'refuse', 'in_work', 'waiting', p_comment);
end $function$

;
CREATE OR REPLACE FUNCTION public.return_request(p_id bigint, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_manager();
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, что исправить'; end if;
  update requests set status = 'in_work', returned_comment = trim(p_comment) where id = p_id and status = 'review';
  if not found then raise exception 'Вернуть можно только заявку «На проверке»'; end if;
  perform public.log_request_event(p_id, 'return', 'review', 'in_work', p_comment);
end $function$

;
CREATE OR REPLACE FUNCTION public.set_request_responsible(p_id bigint, p_employee bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r requests;
begin
  perform public.require_manager();
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if r.status in ('review', 'accepted') then raise exception 'Заявка уже отправлена на проверку'; end if;
  if p_employee is null then
    update requests set status = 'waiting', responsible_id = null, taken_at = null, to_contractor = false where id = p_id;
    delete from request_members where request_id = p_id;
    perform public.log_request_event(p_id, 'responsible', r.status, 'waiting', 'Снята с мастера');
  else
    if not exists (select 1 from employees where id = p_employee and is_active and role = 'master') then
      raise exception 'Мастер не найден';
    end if;
    update requests set status = 'in_work', responsible_id = p_employee, taken_at = coalesce(case when r.responsible_id = p_employee then r.taken_at end, now()),
                        to_contractor = false, assignee_id = p_employee
    where id = p_id;
    delete from request_members where request_id = p_id and employee_id = p_employee;
    perform public.log_request_event(p_id, 'responsible', r.status, 'in_work',
      'Ответственный: ' || (select display_name from employees where id = p_employee));
  end if;
end $function$

;
CREATE OR REPLACE FUNCTION public.assign_request(p_id bigint, p_employee_id bigint, p_contractor boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r requests;
begin
  perform public.require_manager();
  if p_employee_id is not null and not exists (
    select 1 from employees where id = p_employee_id and is_active and role in ('master', 'manager')
  ) then raise exception 'Сотрудник не найден'; end if;
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if coalesce(p_contractor, false) then
    if r.status in ('review', 'accepted') then raise exception 'Заявка уже отправлена на проверку'; end if;
    update requests set assignee_id = null, to_contractor = true, status = 'contractor', responsible_id = null, taken_at = null
    where id = p_id;
    delete from request_members where request_id = p_id;
    perform public.log_request_event(p_id, 'contractor', r.status, 'contractor');
  else
    update requests set assignee_id = p_employee_id, to_contractor = false,
                        status = case when r.status = 'contractor' then 'waiting' else r.status end
    where id = p_id;
    perform public.log_request_event(p_id, 'assign', r.status, case when r.status = 'contractor' then 'waiting' else r.status end,
      coalesce('Назначена: ' || (select display_name from employees where id = p_employee_id), 'Назначение снято'));
  end if;
end $function$

;
CREATE OR REPLACE FUNCTION public.set_request_open(p_id bigint, p_open boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_manager();
  update requests set is_open = p_open,
                      closed_at = case when p_open then null else now() end,
                      closed_by = case when p_open then null else public.current_employee_id() end
  where id = p_id;
  if not found then raise exception 'Заявка не найдена'; end if;
end $function$

;
CREATE OR REPLACE FUNCTION public.close_old_requests(p_before date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  perform public.require_manager();
  if p_before is null or p_before > public.store_today() then raise exception 'Неверная дата'; end if;
  update requests r set is_open = false, closed_at = now(), closed_by = public.current_employee_id()
  where r.source = 'itsm' and r.is_open and r.registered_at < p_before;
  get diagnostics n = row_count;
  return n;
end $function$

;
CREATE OR REPLACE FUNCTION public.my_requests()
 RETURNS TABLE(id bigint, number text, operation text, description text, status text, priority smallint, plan_minutes integer, spent_minutes integer, taken_at timestamp with time zone, returned_comment text, responsible boolean, responsible_name text, unread integer, due_at timestamp without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.number, r.operation, r.description, r.status, r.priority, r.plan_minutes,
         (select coalesce(sum(x.minutes), 0)::int from shift_requests x where x.request_id = r.id),
         r.taken_at, r.returned_comment, r.responsible_id = public.current_employee_id(), e.display_name,
         public.request_unread(r.id, public.current_employee_id(), false), r.due_at
  from requests r
  left join employees e on e.id = r.responsible_id
  where r.status in ('in_work', 'review') and r.is_open
    and (r.responsible_id = public.current_employee_id()
         or exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = public.current_employee_id()))
  order by (r.returned_comment is not null) desc, r.status, r.priority, r.taken_at
$function$

;
CREATE OR REPLACE FUNCTION public.list_requests(q text DEFAULT ''::text, p_limit integer DEFAULT 100, p_status text DEFAULT 'all'::text, p_lifecycle text DEFAULT NULL::text, p_priority smallint DEFAULT NULL::smallint, p_employee bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, number text, subject text, entries bigint, last_work_date date, plan_minutes integer, spent_minutes integer, state text, carries integer, since date, source text, service text, operation text, description text, itsm_status text, registered_at timestamp without time zone, requester text, is_open boolean, assignee_id bigint, assignee_name text, to_contractor boolean, status text, priority smallint, responsible_id bigint, responsible_name text, taken_at timestamp with time zone, last_activity_at timestamp with time zone, returned_comment text, unread integer, stale_days integer, due_at timestamp without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_manager();
  return query
    select r.id, r.number, r.subject,
           (select count(*) from work_entries e where e.request_id = r.id),
           greatest((select max(s.work_date) from work_entries e join shifts s on s.id = e.shift_id where e.request_id = r.id),
                    (select max(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id)),
           r.plan_minutes,
           (select sum(x.minutes)::int from shift_requests x where x.request_id = r.id),
           r.state,
           (select count(*)::int from shift_requests x where x.request_id = r.id and x.status = 'unfinished'),
           (select min(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id),
           r.source, r.service, r.operation, r.description, r.itsm_status,
           r.registered_at, r.requester, r.is_open, r.assignee_id, a.display_name, r.to_contractor,
           r.status, r.priority, r.responsible_id, rp.display_name, r.taken_at, r.last_activity_at, r.returned_comment,
           public.request_unread(r.id, public.current_employee_id(), true),
           case when r.status = 'in_work' then public.working_days_since((coalesce(r.last_activity_at, r.taken_at) at time zone public.app_timezone())::date) else 0 end, r.due_at
    from requests r
    left join employees a on a.id = r.assignee_id
    left join employees rp on rp.id = r.responsible_id
    where (p_status is distinct from 'open' or r.is_open)
      and (p_status is distinct from 'closed' or not r.is_open)
      and (p_lifecycle is null or r.status = p_lifecycle)
      and (p_priority is null or r.priority = p_priority)
      and (p_employee is null or r.responsible_id = p_employee or r.assignee_id = p_employee
           or exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = p_employee))
      and public.search_words_match(public.normalize_search(
            r.number || ' ' || coalesce(r.subject, '') || ' ' || coalesce(r.operation, '') || ' ' || coalesce(r.description, '')), q)
    order by r.is_open desc, (r.status = 'review') desc, r.priority, greatest(
               (select max(s.work_date) from work_entries e join shifts s on s.id = e.shift_id where e.request_id = r.id)::timestamp,
               (select max(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id)::timestamp,
               r.registered_at, r.created_at::timestamp) desc nulls last
    limit least(greatest(p_limit, 1), 300);
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
    'taken_at', r.taken_at, 'sent_at', r.sent_at, 'returned_comment', r.returned_comment,
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
      select jsonb_agg(jsonb_build_object('kind', ev.kind, 'at', ev.created_at, 'from', ev.from_status, 'to', ev.to_status,
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
      'stale', (select count(*)::int from requests r where r.status = 'in_work' and r.is_open
                and public.working_days_since((coalesce(r.last_activity_at, r.taken_at) at time zone public.app_timezone())::date) > 3)
    );
  end if;
  select coalesce(e.store_id, public.default_store_id()) into v_store from employees e where e.id = me;
  return jsonb_build_object(
    'unread', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'count', u.n) order by r.last_activity_at desc)
        from requests r cross join lateral (select public.request_unread(r.id, me, false) n) u
        where u.n > 0 and r.is_open and r.status <> 'accepted'
          and (r.responsible_id = me or r.assignee_id = me
               or exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = me))), '[]'::jsonb),
    'returned', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'comment', r.returned_comment))
        from requests r where r.status = 'in_work' and r.responsible_id = me and r.returned_comment is not null), '[]'::jsonb),
    'urgent', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'operation', r.operation, 'status', r.status)
                                         order by r.registered_at desc)
        from requests r where r.is_open and r.priority = 1
          and (r.status = 'waiting' and r.store_id = v_store and (r.assignee_id is null or r.assignee_id = me)
               or r.status = 'in_work' and r.responsible_id = me)), '[]'::jsonb)
  );
end $function$

;
revoke all on function public.my_requests() from public, anon;
grant execute on function public.my_requests() to authenticated;
revoke all on function public.list_requests(text, integer, text, text, smallint, bigint) from public, anon;
grant execute on function public.list_requests(text, integer, text, text, smallint, bigint) to authenticated;
drop function public.resume_next(bigint);
drop function public.assert_free(bigint, bigint, boolean);
drop function public.active_request_of(bigint, bigint);
drop function public.request_label(text);
alter table public.requests drop column hold_for, drop column hold_reason, drop column paused_at,
  drop column pause_request, drop column pause_requested_at;
commit;
notify pgrst, 'reload schema';
