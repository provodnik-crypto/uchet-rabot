-- Этап «Обратная связь» (22.11.2026). Форма «Написать разработчику» во всех трёх ролях
-- (МВСО, мастер, инициатор) — через «Помощь» и профиль. Сообщения видит только аккаунт
-- разработчика (логин 60133303): список, «прочитано», счётчик в my_notifications().
-- Прямой доступ к таблице закрыт — всё только через RPC. Откат: supabase/rollback/20261122000004_feedback_down.sql.

-- ---------- Сообщения разработчику ----------
create table public.developer_feedback (
  id bigserial primary key,
  employee_id bigint not null references public.employees (id),
  body text not null check (length(body) between 3 and 1000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index developer_feedback_unread_idx on public.developer_feedback (read_at, created_at desc);
alter table public.developer_feedback enable row level security;
revoke all on public.developer_feedback from anon, authenticated;

-- ---------- Отправка: все три роли (инициатор не проходит как employee) ----------
create function public.submit_developer_feedback(p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me bigint := coalesce(public.current_employee_id(), public.current_initiator_id());
  v_body text;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  v_body := trim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  if length(v_body) < 3 then raise exception 'Опишите, что улучшить или что не работает'; end if;
  if length(v_body) > 1000 then raise exception 'Слишком длинно: до 1000 знаков'; end if;
  perform public.assert_clean_text(v_body, 'В сообщении');
  insert into developer_feedback (employee_id, body) values (me, v_body);
end $$;
revoke all on function public.submit_developer_feedback(text) from public, anon;
grant execute on function public.submit_developer_feedback(text) to authenticated;

-- ---------- Аккаунт разработчика (логин 60133303): список, «прочитано», счётчик ----------
create function public.is_developer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.login from employees e where e.id = public.current_employee_id()), '') = '60133303'
$$;
revoke all on function public.is_developer() from public, anon;
grant execute on function public.is_developer() to authenticated;

create function public.developer_feedback_list()
returns table (id bigint, author text, body text, created_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_developer() then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select f.id, e.display_name, f.body, f.created_at, f.read_at
    from developer_feedback f
    join employees e on e.id = f.employee_id
    order by f.created_at desc, f.id desc;
end $$;
revoke all on function public.developer_feedback_list() from public, anon;
grant execute on function public.developer_feedback_list() to authenticated;

create function public.developer_feedback_mark_read() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_developer() then raise exception 'Нет доступа' using errcode = '42501'; end if;
  update developer_feedback set read_at = now() where read_at is null;
end $$;
revoke all on function public.developer_feedback_mark_read() from public, anon;
grant execute on function public.developer_feedback_mark_read() to authenticated;

-- ---------- my_notifications: счётчик обратной связи только для логина 60133303 ----------
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
      'stale_days', public.stale_work_days(),
      'feedback', case when (select e.login from employees e where e.id = me) = '60133303'
                  then (select count(*)::int from developer_feedback where read_at is null) else 0 end
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

