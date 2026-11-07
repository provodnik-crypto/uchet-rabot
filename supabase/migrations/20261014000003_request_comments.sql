-- Жизненный цикл заявки (часть 2): переписка в карточке, непрочитанные, уведомления внутри приложения,
-- подсветка заявок «В работе» без действий больше 3 рабочих дней.
-- Откат: supabase/rollback/20261014000003_request_comments_down.sql

-- Комментарии — в той же ленте, что и события.
alter table public.request_events drop constraint request_events_kind_check;
alter table public.request_events add constraint request_events_kind_check
  check (kind in ('take', 'refuse', 'send', 'accept', 'return', 'priority', 'assign',
                  'responsible', 'contractor', 'plan', 'migrate', 'comment'));

-- Точное время каждого события (а не начала транзакции): «прочитано» и новое сообщение не совпадают.
alter table public.request_events alter column created_at set default clock_timestamp();

-- Когда сотрудник последний раз открывал карточку заявки.
create table public.request_reads (
  request_id  bigint not null references public.requests (id) on delete cascade,
  employee_id bigint not null references public.employees (id),
  read_at     timestamptz not null default now(),
  primary key (request_id, employee_id)
);
alter table public.request_reads enable row level security;
revoke all on public.request_reads from anon, authenticated;

-- Непрочитанное по заявке: новые сообщения и важные события от других людей.
-- Руководителю: комментарии, отказы, отправки на проверку. Мастеру: комментарии, возвраты, назначения, «Срочно».
create function public.request_unread(p_request bigint, p_me bigint, p_manager boolean) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from request_events ev
  where ev.request_id = p_request
    and ev.author_id is distinct from p_me
    and ev.created_at > coalesce((select rr.read_at from request_reads rr where rr.request_id = p_request and rr.employee_id = p_me), '-infinity')
    and case when p_manager then ev.kind in ('comment', 'refuse', 'send')
             else ev.kind in ('comment', 'return', 'responsible', 'assign') or (ev.kind = 'priority' and ev.comment = 'Срочно') end
$$;

-- Рабочих дней после даты d (по производственному календарю), до сегодня включительно.
create function public.working_days_since(d date) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(d + 1, public.store_today(), interval '1 day') g where public.is_workday(g::date)
$$;

create function public.mark_request_read(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id();
begin
  if me is null then raise exception 'Нет доступа'; end if;
  insert into request_reads (request_id, employee_id, read_at) values (p_id, me, clock_timestamp())
  on conflict (request_id, employee_id) do update set read_at = excluded.read_at;
end $$;

-- Комментарий: мастер или руководитель. Последнее действие по заявке обновляется.
create function public.add_request_comment(p_id bigint, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id();
begin
  if me is null then raise exception 'Нет доступа'; end if;
  if length(trim(coalesce(p_text, ''))) = 0 then raise exception 'Напишите сообщение'; end if;
  if length(trim(p_text)) > 1000 then raise exception 'Сообщение длиннее 1000 знаков'; end if;
  if not exists (select 1 from requests where id = p_id) then raise exception 'Заявка не найдена'; end if;
  perform public.log_request_event(p_id, 'comment', null, null, p_text);
  perform public.mark_request_read(p_id);
end $$;

-- Уведомления внутри приложения (главная).
-- Мастер: новые сообщения по моим заявкам, возвращённые, срочные. Руководитель: новые сообщения/отказы/отправки, без действий 3+ дней.
create function public.my_notifications() returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
end $$;

-- ---------- Списки и карточка: + непрочитанные, «мой» комментарий, дни без действий ----------
create or replace function public.request_card(p_id bigint default null, p_number text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    'registered_at', r.registered_at, 'requester_name', public.requester_short(r.requester),
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
    'time_by_day', coalesce((select jsonb_agg(jsonb_build_object('work_date', s.work_date, 'minutes', x.minutes, 'author', e.display_name)
                                              order by s.work_date)
                             from shift_requests x join shifts s on s.id = x.shift_id join employees e on e.id = s.author_id
                             where x.request_id = r.id and x.minutes > 0), '[]'::jsonb),
    'works', coalesce((
      select jsonb_agg(jsonb_build_object(
               'work_date', s.work_date,
               'name', coalesce(p.short_name, w.custom_name),
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
end $$;

drop function public.open_requests(text, text, integer);
create function public.open_requests(q text default '', p_filter text default 'all', p_limit integer default 300)
returns table (id bigint, number text, service text, operation text, description text, registered_at timestamp,
               requester_name text, assignee_id bigint, assignee_name text, to_contractor boolean, mine boolean,
               status text, priority smallint, responsible_id bigint, responsible_name text, plan_minutes integer,
               spent_minutes integer, returned boolean, member boolean, unread integer)
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_store smallint;
begin
  if me is null then raise exception 'Нет доступа'; end if;
  select coalesce(e.store_id, public.default_store_id()) into v_store from employees e where e.id = me;
  return query
    select r.id, r.number, r.service, r.operation, r.description, r.registered_at,
           public.requester_short(r.requester), r.assignee_id, a.display_name, r.to_contractor,
           coalesce(r.assignee_id = me, false) or coalesce(r.responsible_id = me, false),
           r.status, r.priority, r.responsible_id, rp.display_name, r.plan_minutes,
           (select coalesce(sum(x.minutes), 0)::int from shift_requests x where x.request_id = r.id),
           r.returned_comment is not null,
           exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = me),
           public.request_unread(r.id, me, false)
    from requests r
    left join employees a on a.id = r.assignee_id
    left join employees rp on rp.id = r.responsible_id
    where r.is_open and r.status <> 'accepted'
      and (r.source = 'itsm' and r.store_id = v_store or r.responsible_id = me)
      and (p_filter is distinct from 'mine' or r.assignee_id = me or r.responsible_id = me
           or exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = me))
      and (p_filter is distinct from 'contractor' or r.status = 'contractor')
      and public.search_words_match(public.normalize_search(
            r.number || ' ' || coalesce(r.operation, '') || ' ' || coalesce(r.description, '') || ' ' || coalesce(r.service, '')), q)
    order by (coalesce(r.assignee_id = me, false) or coalesce(r.responsible_id = me, false)) desc,
             r.priority, r.registered_at desc nulls last, r.id desc
    limit least(greatest(p_limit, 1), 500);
end $$;

drop function public.my_requests();
create function public.my_requests()
returns table (id bigint, number text, operation text, description text, status text, priority smallint,
               plan_minutes integer, spent_minutes integer, taken_at timestamptz, returned_comment text,
               responsible boolean, responsible_name text, unread integer)
language sql stable security definer set search_path = public as $$
  select r.id, r.number, r.operation, r.description, r.status, r.priority, r.plan_minutes,
         (select coalesce(sum(x.minutes), 0)::int from shift_requests x where x.request_id = r.id),
         r.taken_at, r.returned_comment, r.responsible_id = public.current_employee_id(), e.display_name,
         public.request_unread(r.id, public.current_employee_id(), false)
  from requests r
  left join employees e on e.id = r.responsible_id
  where r.status in ('in_work', 'review') and r.is_open
    and (r.responsible_id = public.current_employee_id()
         or exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = public.current_employee_id()))
  order by (r.returned_comment is not null) desc, r.status, r.priority, r.taken_at
$$;

drop function public.list_requests(text, integer, text, text, smallint, bigint);
create function public.list_requests(q text default '', p_limit integer default 100, p_status text default 'all',
                                     p_lifecycle text default null, p_priority smallint default null,
                                     p_employee bigint default null)
returns table (id bigint, number text, subject text, entries bigint, last_work_date date,
               plan_minutes integer, spent_minutes integer, state text, carries integer, since date,
               source text, service text, operation text, description text, itsm_status text,
               registered_at timestamp, requester text, is_open boolean, assignee_id bigint,
               assignee_name text, to_contractor boolean,
               status text, priority smallint, responsible_id bigint, responsible_name text,
               taken_at timestamptz, last_activity_at timestamptz, returned_comment text,
               unread integer, stale_days integer)
language plpgsql stable security definer set search_path = public as $$
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
           case when r.status = 'in_work' then public.working_days_since((coalesce(r.last_activity_at, r.taken_at) at time zone public.app_timezone())::date) else 0 end
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
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.working_days_since(date)',
    'public.mark_request_read(bigint)',
    'public.add_request_comment(bigint, text)',
    'public.my_notifications()',
    'public.request_card(bigint, text)',
    'public.open_requests(text, text, integer)',
    'public.my_requests()',
    'public.list_requests(text, integer, text, text, smallint, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- счётчик считается только внутри функций выше: чужие отметки «прочитано» не видны
  revoke all on function public.request_unread(bigint, bigint, boolean) from public, anon, authenticated;
end $$;
