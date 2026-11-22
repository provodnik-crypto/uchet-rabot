-- Откат этапа «Обратная связь» (22.11.2026). Точка восстановления данных: backups/db_backup_2026-11-22_initiators.json.gz.

-- ---------- my_notifications: как до этапа ----------
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
      'reports', (select count(*)::int from master_reports m where m.status = 'new' or (m.status = 'read' and m.kind in ('contractor', 'close'))),
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

drop function if exists
  public.developer_feedback_mark_read(),
  public.developer_feedback_list(),
  public.is_developer(),
  public.submit_developer_feedback(text);

-- ---------- Таблица ----------
drop table if exists public.developer_feedback;
