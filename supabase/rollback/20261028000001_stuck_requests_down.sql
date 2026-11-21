-- Откат 20261028000001_stuck_requests: прежние версии функций.
drop trigger if exists requests_stale_asks on public.requests;
drop trigger if exists employees_release on public.employees;
drop function if exists public.requests_stale_asks_tg(); drop function if exists public.employees_release_tg();
drop function if exists public.release_employee_requests(bigint, boolean); drop function if exists public.release_employee_requests_core(bigint);
drop function if exists public.employee_open_requests(bigint); drop function if exists public.old_open_skipped(date); drop function if exists public.close_request_core(bigint);
CREATE OR REPLACE FUNCTION public.set_request_open(p_id bigint, p_open boolean)
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
  if p_open and not r.is_open and r.status = 'in_work' then
    perform 1 from employees where id = r.responsible_id for update;
    if (public.active_request_of(r.responsible_id, p_id)).id is not null then
      update requests set status = 'paused', hold_reason = 'pause', paused_at = now(), pause_request = null, pause_requested_at = null
      where id = p_id;
    end if;
  end if;
  update requests set is_open = p_open,
                      closed_at = case when p_open then null else now() end,
                      closed_by = case when p_open then null else public.current_employee_id() end
  where id = p_id;
  if not p_open and r.status = 'in_work' then perform public.resume_next(r.responsible_id); end if;
end $function$

;

CREATE OR REPLACE FUNCTION public.request_import_apply(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  v_import bigint;
  v_new int;
  v_closed int := 0;
  v_bad text;
begin
  perform public.require_manager();
  if jsonb_typeof(p -> 'rows') is distinct from 'array' then raise exception 'Нет строк для загрузки'; end if;

  select x ->> 'store_code' into v_bad
  from jsonb_array_elements(p -> 'rows') x
  where not exists (select 1 from stores s where s.code = x ->> 'store_code' and s.is_active)
  limit 1;
  if found then raise exception 'Магазина % нет в справочнике', coalesce(v_bad, '(пусто)'); end if;

  insert into request_imports (created_by, window_from, window_to, file_rows, new_rows, existing_rows,
                               outside_rows, error_rows, closed_rows)
  values (me, nullif(p ->> 'window_from', '')::date, nullif(p ->> 'window_to', '')::date,
          coalesce((p ->> 'file_rows')::int, 0), 0, coalesce((p ->> 'existing_rows')::int, 0),
          coalesce((p ->> 'outside_rows')::int, 0), coalesce((p ->> 'error_rows')::int, 0), 0)
  returning id into v_import;

  with ins as (
    insert into requests (number, source, store_id, service, operation, description, subject, itsm_status,
                          registered_at, requester, created_by, import_id, due_at)
    select x ->> 'number', 'itsm', s.id,
           nullif(trim(x ->> 'service'), ''), nullif(trim(x ->> 'operation'), ''),
           nullif(trim(x ->> 'description'), ''), nullif(trim(x ->> 'operation'), ''),
           nullif(trim(x ->> 'status'), ''), (x ->> 'registered_at')::timestamp,
           nullif(trim(x ->> 'requester'), ''), me, v_import, nullif(x ->> 'due_at', '')::timestamp
    from jsonb_array_elements(p -> 'rows') x
    join stores s on s.code = x ->> 'store_code'
    on conflict (number) do nothing
    returning 1
  )
  select count(*) into v_new from ins;

  -- сроки уже загруженных заявок: [{number, due_at}]
  if jsonb_typeof(p -> 'due_updates') = 'array' then
    update requests r set due_at = (x ->> 'due_at')::timestamp
    from jsonb_array_elements(p -> 'due_updates') x
    where r.number = x ->> 'number' and r.source = 'itsm' and nullif(x ->> 'due_at', '') is not null
      and r.due_at is distinct from (x ->> 'due_at')::timestamp;
  end if;

  if jsonb_typeof(p -> 'close_ids') = 'array' then
    update requests r set is_open = false, closed_at = now(), closed_by = me
    where r.id in (select (v)::bigint from jsonb_array_elements_text(p -> 'close_ids') v)
      and r.source = 'itsm' and r.is_open;
    get diagnostics v_closed = row_count;
  end if;

  update request_imports set new_rows = v_new, closed_rows = v_closed,
         existing_rows = existing_rows + (jsonb_array_length(p -> 'rows') - v_new)
  where id = v_import;
  return jsonb_build_object('import_id', v_import, 'inserted', v_new,
                            'skipped', jsonb_array_length(p -> 'rows') - v_new, 'closed', v_closed);
end $function$

;

CREATE OR REPLACE FUNCTION public.request_import_context(p_numbers text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := public.store_today();
  v_last timestamptz;
  w record;
begin
  perform public.require_manager();
  select max(created_at) into v_last from request_imports;
  select * into w from public.import_window(v_today, (v_last at time zone 'Asia/Yekaterinburg')::date);
  return jsonb_build_object(
    'today', v_today,
    'first', v_last is null,
    'last_import_at', v_last,
    'window_from', w.window_from,
    'window_to', w.window_to,
    'existing', coalesce((select jsonb_agg(r.number) from requests r where r.number = any (p_numbers)), '[]'::jsonb),
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'operation', r.operation,
                                          'description', r.description, 'registered_at', r.registered_at)
                       order by r.registered_at desc nulls last)
      from requests r
      where r.source = 'itsm' and r.is_open and not (r.number = any (p_numbers))), '[]'::jsonb),
    'stores', (select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.code)
               from stores s where s.is_active)
  );
end $function$

;

CREATE OR REPLACE FUNCTION public.close_old_requests(p_before date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer; v bigint; v_freed bigint[];
begin
  perform public.require_manager();
  if p_before is null or p_before > public.store_today() then raise exception 'Неверная дата'; end if;
  select array_agg(distinct r.responsible_id) into v_freed from requests r
  where r.source = 'itsm' and r.is_open and r.registered_at < p_before and r.status = 'in_work';
  update requests r set is_open = false, closed_at = now(), closed_by = public.current_employee_id()
  where r.source = 'itsm' and r.is_open and r.registered_at < p_before;
  get diagnostics n = row_count;
  foreach v in array coalesce(v_freed, '{}') loop perform public.resume_next(v); end loop;
  return n;
end $function$

;

CREATE OR REPLACE FUNCTION public.old_open_requests(p_before date)
 RETURNS TABLE(id bigint, number text, operation text, description text, registered_at timestamp without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_manager();
  return query
    select r.id, r.number, r.operation, r.description, r.registered_at
    from requests r
    where r.source = 'itsm' and r.is_open and r.registered_at < p_before
    order by r.registered_at, r.id;
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
  if not public.legacy_shift_allowed()
     and not exists (select 1 from extra_photos x where x.owner_kind = 'result' and x.owner_id = p_id) then
    raise exception 'Добавьте фото результата';
  end if;
  if not exists (select 1 from work_entries where request_id = p_id and status <> 'rejected') then
    raise exception 'Добавьте хотя бы одну работу по заявке';
  end if;
  update requests set status = 'review', sent_at = now(), returned_comment = null, pause_request = null, pause_requested_at = null
  where id = p_id;
  perform public.log_request_event(p_id, 'send', 'in_work', 'review', p_comment);
  perform public.resume_next(me);
end $function$

;

CREATE OR REPLACE FUNCTION public.send_request_for_review_photos(p_id bigint, p_comment text, p_photos jsonb)
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
  perform public.attach_extra_photos('result', p_id, coalesce(p_photos, '[]'::jsonb), 1);
  perform public.send_request_for_review(p_id, p_comment);
end $function$

;

CREATE OR REPLACE FUNCTION public.refuse_request(p_id bigint, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me bigint := public.current_employee_id(); v_shifts bigint[]; n integer;
begin
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, почему отказываетесь'; end if;
  update requests set status = 'waiting', responsible_id = null, taken_at = null, returned_comment = null,
                      pause_request = null, pause_requested_at = null
  where id = p_id and status = 'in_work' and responsible_id = me;
  if not found then raise exception 'Отказаться может только мастер, который взял заявку'; end if;
  -- несданные работы по заявке удаляются: следующий мастер начинает с чистой заявки
  select array_agg(distinct shift_id) into v_shifts from work_entries where request_id = p_id and status in ('awaiting', 'pending');
  delete from work_entries where request_id = p_id and status in ('awaiting', 'pending');
  get diagnostics n = row_count;
  delete from shifts x where x.id = any (coalesce(v_shifts, '{}')) and not exists (select 1 from work_entries where shift_id = x.id)
    and not exists (select 1 from shift_requests where shift_id = x.id);
  delete from request_members where request_id = p_id;
  perform public.log_request_event(p_id, 'refuse', 'in_work', 'waiting',
    p_comment || case when n > 0 then ' (удалено работ: ' || n || ')' else '' end);
  perform public.resume_next(me);
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
      perform public.log_request_event(m.about_request, 'comment', null, null,
        case m.kind when 'close' then 'Заявку не закрываем: ' else 'Подрядчику не передаём: ' end || left(trim(p_comment), 900));
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
  elsif p_action = 'close' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;
    if m.status = 'closed' then raise exception 'Заявка уже закрыта'; end if;
    perform public.set_request_open(m.about_request, false);
    perform public.log_request_event(m.about_request, 'comment', null, null,
      'Заявка закрыта по просьбе мастера' || coalesce(': ' || nullif(left(trim(coalesce(p_comment, '')), 900), ''), ''));
    update master_reports set status = 'closed', answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return null;
  end if;
  raise exception 'Неизвестное действие';
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
      'materials', (select count(*)::int from requests r where r.status = 'paused' and r.hold_reason = 'materials' and r.is_open),
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

