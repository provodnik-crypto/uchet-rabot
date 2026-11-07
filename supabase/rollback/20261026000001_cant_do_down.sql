-- Откат 20261026000001_cant_do: прежние версии функций, без «Не могу выполнить».
drop function if exists public.cant_do(bigint, text, text);
CREATE OR REPLACE FUNCTION public.list_requests(q text DEFAULT ''::text, p_limit integer DEFAULT 100, p_status text DEFAULT 'all'::text, p_lifecycle text DEFAULT NULL::text, p_priority smallint DEFAULT NULL::smallint, p_employee bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, number text, subject text, entries bigint, last_work_date date, plan_minutes integer, spent_minutes integer, state text, carries integer, since date, source text, service text, operation text, description text, itsm_status text, registered_at timestamp without time zone, requester text, is_open boolean, assignee_id bigint, assignee_name text, to_contractor boolean, status text, priority smallint, responsible_id bigint, responsible_name text, taken_at timestamp with time zone, last_activity_at timestamp with time zone, returned_comment text, unread integer, stale_days integer, due_at timestamp without time zone, hold_reason text, hold_number text, pause_request text, pause_requested_at timestamp with time zone, work_days integer)
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
           case when r.status = 'in_work' then public.working_days_since((coalesce(r.last_activity_at, r.taken_at) at time zone public.app_timezone())::date) else 0 end, r.due_at,
           r.hold_reason, (select h.number from requests h where h.id = r.hold_for), r.pause_request, r.pause_requested_at,
           case when r.status = 'in_work' then public.request_work_days(r.taken_at) end
    from requests r
    left join employees a on a.id = r.assignee_id
    left join employees rp on rp.id = r.responsible_id
    where (p_status is distinct from 'open' or r.is_open)
      and (p_status is distinct from 'closed' or not r.is_open)
      and (p_lifecycle is null or r.status = p_lifecycle or p_lifecycle = 'pause_request' and r.pause_request is not null)
      and (p_priority is null or r.priority = p_priority)
      and (p_employee is null or r.responsible_id = p_employee or r.assignee_id = p_employee
           or exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = p_employee))
      and public.search_words_match(public.normalize_search(
            r.number || ' ' || coalesce(r.subject, '') || ' ' || coalesce(r.operation, '') || ' ' || coalesce(r.description, '')), q)
    order by r.is_open desc, (r.pause_request is not null) desc, (r.status = 'review') desc, r.priority, greatest(
               (select max(s.work_date) from work_entries e join shifts s on s.id = e.shift_id where e.request_id = r.id)::timestamp,
               (select max(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id)::timestamp,
               r.registered_at, r.created_at::timestamp) desc nulls last
    limit least(greatest(p_limit, 1), 300);
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
      'reports', (select count(*)::int from master_reports m where m.status = 'new'),
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
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status, 'text', left(m.text, 80),
                                                     'answer', m.answer, 'request_number', (select r.number from requests r where r.id = m.request_id)))
        from master_reports m where m.author_id = me and m.decided_at is not null and m.seen_at is null and m.status <> 'read'), '[]'::jsonb),
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

CREATE OR REPLACE FUNCTION public.request_contractor(p_id bigint, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me bigint := public.current_employee_id(); r requests; v_id bigint;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Напишите, почему нужен подрядчик'; end if;
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if r.status not in ('in_work', 'paused') or (r.responsible_id is distinct from me
     and not exists (select 1 from request_members m where m.request_id = p_id and m.employee_id = me)) then
    raise exception 'Попросить можно только по своей заявке в работе';
  end if;
  if exists (select 1 from master_reports where about_request = p_id and status in ('new', 'read')) then
    raise exception 'Просьба уже у руководителя — дождитесь ответа';
  end if;
  insert into master_reports (author_id, text, about_request) values (me, left(trim(p_reason), 1000), p_id) returning id into v_id;
  perform public.log_request_event(p_id, 'comment', null, null, 'Прошу передать подрядчику: ' || left(trim(p_reason), 900));
  return v_id;
end $function$

;

CREATE OR REPLACE FUNCTION public.decide_master_report(p_id bigint, p_action text, p_comment text DEFAULT NULL::text, p_title text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m master_reports; v_req jsonb;
begin
  perform public.require_manager();
  select * into m from master_reports where id = p_id for update;
  if m.id is null then raise exception 'Сообщение не найдено'; end if;
  if p_action = 'read' then
    if m.status = 'new' then
      update master_reports set status = 'read', decided_at = now(), decided_by = public.current_employee_id() where id = p_id;
    end if;
    return null;
  elsif p_action = 'reject' then
    if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите мастеру причину'; end if;
    update master_reports set status = 'rejected', answer = trim(p_comment), decided_at = now(),
           decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    if m.about_request is not null then
      perform public.log_request_event(m.about_request, 'comment', null, null, 'Подрядчику не передаём: ' || left(trim(p_comment), 900));
    end if;
    return null;
  elsif p_action = 'request' then
    if m.status = 'request' then raise exception 'Заявка по сообщению уже создана'; end if;
    v_req := public.create_manual_request(coalesce(nullif(trim(p_title), ''), left(m.text, 200)), m.text, null);
    update master_reports set status = 'request', request_id = (v_req ->> 'id')::bigint, answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return v_req;
  elsif p_action = 'contractor' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;
    if m.status = 'contractor' then raise exception 'Заявка уже передана подрядчику'; end if;
    perform public.assign_request(m.about_request, null, true);
    update master_reports set status = 'contractor', answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return null;
  end if;
  raise exception 'Неизвестное действие';
end $function$

;

CREATE OR REPLACE FUNCTION public.my_master_reports()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'text', m.text, 'status', m.status, 'answer', m.answer, 'created_at', m.created_at,
           'decided_at', m.decided_at, 'request_id', m.request_id,
           'request_number', (select r.number from requests r where r.id = m.request_id),
           'about_request', m.about_request, 'about_number', (select r.number from requests r where r.id = m.about_request),
           'unseen', m.decided_at is not null and m.seen_at is null and m.status <> 'read',
           'photos', public.report_photos(m.id)) order by m.created_at desc), '[]'::jsonb)
  from (select * from master_reports where author_id = public.current_employee_id() order by created_at desc limit 30) m
$function$

;

CREATE OR REPLACE FUNCTION public.list_master_reports(p_open boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_manager();
  return coalesce((select jsonb_agg(jsonb_build_object(
           'id', m.id, 'text', m.text, 'status', m.status, 'answer', m.answer, 'created_at', m.created_at,
           'author', e.display_name, 'request_id', m.request_id,
           'request_number', (select r.number from requests r where r.id = m.request_id),
           'about_request', m.about_request, 'about_number', (select r.number from requests r where r.id = m.about_request),
           'photos', public.report_photos(m.id)) order by (m.status in ('new', 'read')) desc, m.created_at desc)
    from (select * from master_reports
          where not p_open or status in ('new', 'read') or created_at > now() - interval '30 days'
          order by created_at desc limit 100) m
    join employees e on e.id = m.author_id), '[]'::jsonb);
end $function$

;

update public.requests set hold_reason = 'pause' where hold_reason = 'materials';
alter table public.requests drop constraint requests_hold_check;
alter table public.requests add constraint requests_hold_check
  check (((status = 'paused') = (hold_reason is not null)) and (hold_reason is null or hold_reason = any (array['urgent', 'returned', 'pause'])));
update public.master_reports set status = 'read' where status = 'closed';
alter table public.master_reports drop constraint master_reports_status_check;
alter table public.master_reports add constraint master_reports_status_check
  check (status in ('new', 'read', 'request', 'rejected', 'contractor'));
alter table public.master_reports drop column kind;
