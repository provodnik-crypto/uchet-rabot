-- Жизненный цикл заявки (часть 1): Ожидает → В работе → На проверке → Принята; У подрядчика.
-- * мастер берёт заявку в работу с примерным временем (оно же план) и напарниками;
-- * взять может только один — проверка одной операцией на сервере;
-- * работы по заявке получают цену как раньше, но в суммы идут только после «Принята»
--   (статус работы awaiting — «Ждёт приёмки»); работы без заявки — сразу, как раньше;
-- * приоритет, история смен статуса, снять/переназначить (руководитель).
-- Откат: supabase/rollback/20261014000002_request_lifecycle_down.sql

-- ---------- Заявка: статус, ответственный, приоритет ----------
alter table public.requests
  add column status            text not null default 'waiting'
                               check (status in ('waiting', 'in_work', 'review', 'accepted', 'contractor')),
  add column responsible_id    bigint references public.employees (id),
  add column taken_at          timestamptz,
  add column sent_at           timestamptz,
  add column priority          smallint not null default 3 check (priority between 1 and 4), -- 1 срочно … 4 низкий
  add column returned_comment  text check (returned_comment is null or length(returned_comment) <= 1000),
  add column last_activity_at  timestamptz;
create index requests_status_idx on public.requests (status) where is_open;
create index requests_responsible_idx on public.requests (responsible_id) where responsible_id is not null;

-- Напарники: числятся в заявке, по умолчанию — исполнители её работ (деньги делятся поровну).
create table public.request_members (
  request_id  bigint not null references public.requests (id) on delete cascade,
  employee_id bigint not null references public.employees (id),
  primary key (request_id, employee_id)
);
alter table public.request_members enable row level security;
revoke all on public.request_members from anon, authenticated;

-- История и (во второй части) переписка: кто, когда, из какого статуса в какой.
create table public.request_events (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.requests (id) on delete cascade,
  kind        text not null check (kind in ('take', 'refuse', 'send', 'accept', 'return', 'priority', 'assign',
                                            'responsible', 'contractor', 'plan', 'migrate')),
  author_id   bigint references public.employees (id),
  from_status text,
  to_status   text,
  comment     text check (comment is null or length(comment) <= 1000),
  created_at  timestamptz not null default now()
);
create index request_events_request_idx on public.request_events (request_id, created_at);
alter table public.request_events enable row level security;
revoke all on public.request_events from anon, authenticated;

grant select (status, responsible_id, taken_at, sent_at, priority, returned_comment, last_activity_at)
  on public.requests to authenticated;

create function public.log_request_event(p_request bigint, p_kind text, p_from text, p_to text, p_comment text default null)
returns void
language sql security definer set search_path = public as $$
  insert into request_events (request_id, kind, author_id, from_status, to_status, comment)
  values (p_request, p_kind, public.current_employee_id(), p_from, p_to, nullif(trim(p_comment), ''));
  update requests set last_activity_at = now() where id = p_request;
$$;

-- Старое поле state («не закончена / выполнена») держим в согласии со статусом:
-- на нём построены статистика времени и лист «Время» в Excel.
create or replace function public.refresh_request_state(p_request bigint) returns void
language sql security definer set search_path = public as $$
  update requests set state = case status when 'accepted' then 'done' when 'in_work' then 'open' when 'review' then 'open' else state end
  where id = p_request
$$;

create function public.requests_sync_state() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.state := case new.status when 'accepted' then 'done' when 'in_work' then 'open' when 'review' then 'open' else new.state end;
  end if;
  return new;
end $$;
create trigger requests_sync_state before update of status on public.requests
  for each row execute function public.requests_sync_state();

-- ---------- Работы: «Ждёт приёмки» до «Принята» ----------
alter table public.work_entries drop constraint work_entries_status_check;
alter table public.work_entries add constraint work_entries_status_check
  check (status in ('priced', 'pending', 'rejected', 'awaiting'));
-- Старые работы (до этой доработки) считаются как раньше.
alter table public.work_entries add column needs_acceptance boolean not null default false;

create function public.work_entries_acceptance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.needs_acceptance := new.request_id is not null and not new.is_imported;
  end if;
  if new.status = 'priced' and new.needs_acceptance
     and exists (select 1 from requests r where r.id = new.request_id and r.status <> 'accepted') then
    new.status := 'awaiting';
  end if;
  if new.request_id is not null then
    update requests set last_activity_at = now() where id = new.request_id;
  end if;
  return new;
end $$;
create trigger work_entries_acceptance before insert or update of status, request_id on public.work_entries
  for each row execute function public.work_entries_acceptance();

-- ---------- Перенос уже внесённых заявок ----------
update public.requests r set status = 'contractor' where r.to_contractor;
update public.requests r set status = 'accepted' where r.status = 'waiting' and r.state = 'done';
update public.requests r
   set status = 'in_work',
       responsible_id = (select s.author_id from shift_requests sr join shifts s on s.id = sr.shift_id
                         where sr.request_id = r.id order by s.work_date desc, s.submitted_at desc limit 1),
       taken_at = (select min(s.submitted_at) from shift_requests sr join shifts s on s.id = sr.shift_id where sr.request_id = r.id)
 where r.status = 'waiting' and r.state = 'open'
   and exists (select 1 from shift_requests sr where sr.request_id = r.id);
-- ручные номера, введённые до этой доработки (тестовые), из обращения убираем
update public.requests r set status = 'accepted' where r.status = 'waiting' and r.source = 'manual';
insert into public.request_events (request_id, kind, to_status, comment)
select id, 'migrate', status, 'Статус при переходе на новую схему' from public.requests where status <> 'waiting';
update public.requests set last_activity_at = coalesce(last_activity_at, created_at);
-- В работе и на проверке всегда есть ответственный; у ожидающих и у подрядчика — нет.
alter table public.requests add constraint requests_responsible_status
  check (status = 'accepted' or (status in ('in_work', 'review')) = (responsible_id is not null));

-- ---------- Проверка: можно ли мастеру вносить работы по заявке ----------
-- Ожидающую заявку работа берёт в работу автоматически (номер «Нет в списке» — так же).
create function public.claim_request_for_work(p_request bigint, p_author bigint) returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- submit_shift: перед записью работ по заявкам проверяем, чья заявка. Обёртка над прежней функцией.
alter function public.submit_shift(jsonb) rename to submit_shift_core;
revoke all on function public.submit_shift_core(jsonb) from public, anon, authenticated;

create function public.submit_shift(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
      if v_num !~ '^(RFS|INC)\d{6}_\d{4}$' then raise exception 'Номер заявки % в неверном формате', v_num; end if;
      insert into requests (number, created_by) values (v_num, me) on conflict (number) do nothing;
      select id into v_req from requests where number = v_num;
      perform public.claim_request_for_work(v_req, me);
    end loop;
  end if;
  return public.submit_shift_core(payload);
end $$;

-- «Не закончено» больше нет: время за смену сохраняется, статус заявки ведёт её жизненный цикл.
create or replace function public.save_shift_requests(p_shift bigint, p_requests jsonb) returns void
language plpgsql security definer set search_path = public as $$
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
      if v_num !~ '^(RFS|INC)\d{6}_\d{4}$' then raise exception 'Номер заявки % в неверном формате', v_num; end if;
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
end $$;

-- Заявки «В работе» у мастера — встают в начало смены (раньше — «не закончено»).
create or replace function public.my_open_requests()
returns table (number text, since date, last_date date, spent_minutes integer, entries integer, plan_minutes integer)
language sql stable security definer set search_path = public as $$
  select r.number,
         coalesce((r.taken_at at time zone public.app_timezone())::date, r.created_at::date),
         (select max(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id),
         (select coalesce(sum(x.minutes), 0)::int from shift_requests x where x.request_id = r.id),
         (select count(*)::int from work_entries e where e.request_id = r.id and e.status <> 'rejected'),
         r.plan_minutes
  from requests r
  where r.responsible_id = public.current_employee_id() and r.status = 'in_work'
  order by r.priority, r.taken_at
$$;

-- ---------- Действия мастера ----------
-- Взять в работу. Одна операция: из двух одновременных нажатий проходит одно.
create function public.take_request(p_id bigint, p_plan_minutes integer, p_member_ids bigint[] default '{}')
returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- Отказаться: заявка снова «Ожидает», руководитель увидит отказ с комментарием.
create function public.refuse_request(p_id bigint, p_comment text)
returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id();
begin
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, почему отказываетесь'; end if;
  update requests set status = 'waiting', responsible_id = null, taken_at = null, returned_comment = null
  where id = p_id and status = 'in_work' and responsible_id = me;
  if not found then raise exception 'Отказаться может только мастер, который взял заявку'; end if;
  delete from request_members where request_id = p_id;
  perform public.log_request_event(p_id, 'refuse', 'in_work', 'waiting', p_comment);
end $$;

-- Отправить на проверку (смена с работами уже сохранена приложением).
create function public.send_request_for_review(p_id bigint, p_comment text default null)
returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- ---------- Действия руководителя ----------
create function public.accept_request(p_id bigint, p_comment text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manager();
  update requests set status = 'accepted' where id = p_id and status = 'review';
  if not found then raise exception 'Принять можно только заявку «На проверке»'; end if;
  -- работы с ценой идут в суммы; вне прайса — после назначения цены
  update work_entries set status = 'priced' where request_id = p_id and status = 'awaiting';
  perform public.log_request_event(p_id, 'accept', 'review', 'accepted', p_comment);
end $$;

create function public.return_request(p_id bigint, p_comment text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manager();
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, что исправить'; end if;
  update requests set status = 'in_work', returned_comment = trim(p_comment) where id = p_id and status = 'review';
  if not found then raise exception 'Вернуть можно только заявку «На проверке»'; end if;
  perform public.log_request_event(p_id, 'return', 'review', 'in_work', p_comment);
end $$;

create function public.set_request_priority(p_id bigint, p_priority smallint)
returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- Снять с мастера (p_employee null — снова «Ожидает») или переназначить другому.
create function public.set_request_responsible(p_id bigint, p_employee bigint)
returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- Назначение (пометка «назначено вам») и подрядчик — с переводом статуса.
create or replace function public.assign_request(p_id bigint, p_employee_id bigint, p_contractor boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- «1 ч 30 мин», «2 дня» — для истории.
create function public.minutes_label(m integer) returns text
language sql immutable as $$
  select case
    when m >= 480 and m % 480 = 0 then (m / 480) || ' дн.'
    when m >= 60 then (m / 60) || ' ч' || case when m % 60 > 0 then ' ' || (m % 60) || ' мин' else '' end
    else m || ' мин' end
$$;

-- ---------- Списки ----------
-- Мастер: открытые заявки магазина, кроме принятых. Сначала назначенные мне и мои, затем приоритет, затем свежие.
drop function public.open_requests(text, text, integer);
create function public.open_requests(q text default '', p_filter text default 'all', p_limit integer default 300)
returns table (id bigint, number text, service text, operation text, description text, registered_at timestamp,
               requester_name text, assignee_id bigint, assignee_name text, to_contractor boolean, mine boolean,
               status text, priority smallint, responsible_id bigint, responsible_name text, plan_minutes integer,
               spent_minutes integer, returned boolean, member boolean)
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
           exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = me)
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

-- Мастер: мои заявки — в работе и на проверке (свои и где я напарник).
create function public.my_requests()
returns table (id bigint, number text, operation text, description text, status text, priority smallint,
               plan_minutes integer, spent_minutes integer, taken_at timestamptz, returned_comment text,
               responsible boolean, responsible_name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.number, r.operation, r.description, r.status, r.priority, r.plan_minutes,
         (select coalesce(sum(x.minutes), 0)::int from shift_requests x where x.request_id = r.id),
         r.taken_at, r.returned_comment, r.responsible_id = public.current_employee_id(), e.display_name
  from requests r
  left join employees e on e.id = r.responsible_id
  where r.status in ('in_work', 'review') and r.is_open
    and (r.responsible_id = public.current_employee_id()
         or exists (select 1 from request_members m where m.request_id = r.id and m.employee_id = public.current_employee_id()))
  order by (r.returned_comment is not null) desc, r.status, r.priority, r.taken_at
$$;

-- Карточка заявки: + статус, ответственный, напарники, время, история.
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
                                          'comment', ev.comment,
                                          'author', case when e.role = 'manager' then 'Руководитель' else e.display_name end)
                       order by ev.created_at desc, ev.id desc)
      from request_events ev left join employees e on e.id = ev.author_id
      where ev.request_id = r.id), '[]'::jsonb)
  );
end $$;

-- Руководитель: список с фильтрами по статусу, приоритету, мастеру.
drop function public.list_requests(text, integer, text);
create function public.list_requests(q text default '', p_limit integer default 100, p_status text default 'all',
                                     p_lifecycle text default null, p_priority smallint default null,
                                     p_employee bigint default null)
returns table (id bigint, number text, subject text, entries bigint, last_work_date date,
               plan_minutes integer, spent_minutes integer, state text, carries integer, since date,
               source text, service text, operation text, description text, itsm_status text,
               registered_at timestamp, requester text, is_open boolean, assignee_id bigint,
               assignee_name text, to_contractor boolean,
               status text, priority smallint, responsible_id bigint, responsible_name text,
               taken_at timestamptz, last_activity_at timestamptz, returned_comment text)
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
           r.status, r.priority, r.responsible_id, rp.display_name, r.taken_at, r.last_activity_at, r.returned_comment
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

-- Главная руководителя и мастера: сколько ждут проверки, мои в работе, мои вернули.
create function public.review_count() returns integer
language sql stable security definer set search_path = public as $$
  select case when public.is_manager() then (select count(*)::int from requests where status = 'review') else 0 end
$$;

-- Сводка мастера за месяц: + работы, которые ждут приёмки заявки.
drop function public.my_month_summary();
create function public.my_month_summary()
returns table (total_kop bigint, requests bigint, entries bigint, pending bigint, awaiting bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_from date := date_trunc('month', public.app_today())::date;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select coalesce(sum(pm.share_kop) filter (where e.status = 'priced'), 0)::bigint,
           count(distinct e.request_id) filter (where e.status = 'priced'),
           count(distinct e.id) filter (where e.status = 'priced'),
           count(distinct e.id) filter (where e.status = 'pending'),
           count(distinct e.id) filter (where e.status = 'awaiting')
    from entry_performers ep
    join work_entries e on e.id = ep.entry_id
    join shifts s on s.id = e.shift_id
    left join performer_money pm on pm.entry_id = e.id and pm.employee_id = me
    where ep.employee_id = me and s.work_date >= v_from and s.work_date <= public.app_today();
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.take_request(bigint, integer, bigint[])',
    'public.refuse_request(bigint, text)',
    'public.send_request_for_review(bigint, text)',
    'public.accept_request(bigint, text)',
    'public.return_request(bigint, text)',
    'public.set_request_priority(bigint, smallint)',
    'public.set_request_responsible(bigint, bigint)',
    'public.assign_request(bigint, bigint, boolean)',
    'public.open_requests(text, text, integer)',
    'public.my_requests()',
    'public.request_card(bigint, text)',
    'public.list_requests(text, integer, text, text, smallint, bigint)',
    'public.review_count()',
    'public.my_month_summary()',
    'public.submit_shift(jsonb)',
    'public.my_open_requests()',
    'public.minutes_label(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.log_request_event(bigint, text, text, text, text)',
    'public.claim_request_for_work(bigint, bigint)',
    'public.submit_shift_core(jsonb)',
    'public.work_entries_acceptance()',
    'public.requests_sync_state()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
