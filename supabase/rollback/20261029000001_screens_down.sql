-- Откат 20261029000001_screens: прежние версии функций.
drop function if exists public.awaiting_totals(date, date); drop function if exists public.request_counts(); drop function if exists public.request_row(bigint); drop function if exists public.set_manual_request_title(bigint, text);
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
      and (p_lifecycle is null or r.status = p_lifecycle or p_lifecycle = 'pause_request' and r.pause_request is not null
               or p_lifecycle = 'materials' and r.status = 'paused' and r.hold_reason = 'materials')
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

CREATE OR REPLACE FUNCTION public.set_request_priority(p_id bigint, p_priority smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old smallint;
begin
  perform public.require_manager();
  if p_priority not between 1 and 4 then raise exception 'Неверный приоритет'; end if;
  select priority into v_old from requests where id = p_id;
  if not found then raise exception 'Заявка не найдена'; end if;
  if v_old = p_priority then return; end if;
  update requests set priority = p_priority where id = p_id;
  perform public.log_request_event(p_id, 'priority', null, null,
    (array['Срочно', 'Высокий', 'Обычный', 'Низкий'])[p_priority]);
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
    'taken_at', r.taken_at, 'is_planned', r.is_planned,
    'result_photos', coalesce((select jsonb_agg(jsonb_build_object('path', x.path, 'thumb_path', x.thumb_path, 'at', x.created_at) order by x.created_at, x.position)
                               from extra_photos x where x.owner_kind = 'result' and x.owner_id = r.id), '[]'::jsonb), 'hold_reason', r.hold_reason, 'paused_at', r.paused_at,
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
               'id', w.id, 'department_id', w.department_id, 'price_item_id', w.price_item_id, 'unit_id', w.unit_id,
               'integer_only', u.integer_only, 'note', w.note, 'category', p.category, 'custom', w.price_item_id is null,
               'performer_ids', (select jsonb_agg(ep.employee_id order by ep.position) from entry_performers ep where ep.entry_id = w.id),
               'can_edit', (public.my_editable_entry(w.id)).id is not null,
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

