-- Правило «у мастера одновременно одна заявка в работе».
-- Активная заявка — открытая, «В работе», мастер ответственный (возвращённая на доработку — тоже «В работе»).
-- * Защита в базе: уникальный индекс по ответственному среди открытых «В работе» + блокировка строки сотрудника
--   во всех функциях, которые делают мастера ответственным (взять, работы в смене, своя заявка, назначение).
-- * Новый статус «Приостановлена» (paused): мастер остаётся ответственным, причина в hold_reason:
--   urgent — из-за срочной (hold_for — какая), returned — вернули на доработку, пока мастер занят другой,
--   pause — приостановка подтверждена руководителем (ждём материалы и т. п.).
-- * Отправил на проверку / отказался / заявку сняли — мастер свободен, в работу сама встаёт следующая из очереди:
--   сначала возвращённая, потом приостановленная из-за срочной (resume_next). Подтверждённую приостановку
--   мастер продолжает сам кнопкой «Продолжить» (resume_request), руководитель — тоже.
-- * «Приостановить» мастером — только запрос (pause_request); до решения руководителя заявка активна.
-- Только добавляет и расширяет: старое приложение продолжает работать (новые поля просто не показывает).
-- Откат: supabase/rollback/20261021000001_one_active_request_down.sql

-- ---------- Поля и правила таблицы ----------
alter table public.requests
  add column hold_reason text,
  add column hold_for bigint references public.requests(id) on delete set null,
  add column paused_at timestamptz,
  add column pause_request text,
  add column pause_requested_at timestamptz;
grant select (hold_reason, hold_for, paused_at, pause_request, pause_requested_at) on public.requests to authenticated;

alter table public.requests drop constraint requests_status_check;
alter table public.requests add constraint requests_status_check
  check (status = any (array['waiting', 'in_work', 'review', 'accepted', 'contractor', 'paused']));
alter table public.requests drop constraint requests_responsible_status;
alter table public.requests add constraint requests_responsible_status
  check (status = 'accepted' or ((status = any (array['in_work', 'review', 'paused'])) = (responsible_id is not null)));
alter table public.requests add constraint requests_hold_check
  check ((status = 'paused') = (hold_reason is not null) and (hold_reason is null or hold_reason = any (array['urgent', 'returned', 'pause'])));
alter table public.requests add constraint requests_pause_request_check
  check (pause_request is null or (status = 'in_work' and length(pause_request) between 3 and 1000));

-- одна открытая заявка «В работе» на ответственного — последняя защита даже при одновременных нажатиях
create unique index requests_one_active_uq on public.requests (responsible_id) where status = 'in_work' and is_open;

alter table public.request_events drop constraint request_events_kind_check;
alter table public.request_events add constraint request_events_kind_check
  check (kind = any (array['take', 'refuse', 'send', 'accept', 'return', 'priority', 'assign', 'responsible', 'contractor',
                           'plan', 'migrate', 'comment', 'create', 'pause_request', 'pause', 'pause_reject', 'resume']));

-- ---------- Помощники ----------
create function public.request_label(p_number text) returns text
language sql immutable as $$ select case when p_number ~ '^\d+$' then '№ ' || p_number else p_number end $$;

/** Открытая заявка «В работе» сотрудника (кроме p_except). */
create function public.active_request_of(p_emp bigint, p_except bigint default null) returns public.requests
language sql stable security definer set search_path = public as $$
  select * from requests where responsible_id = p_emp and status = 'in_work' and is_open
    and id is distinct from p_except limit 1
$$;

/** Блокирует сотрудника (одновременные нажатия идут по очереди) и проверяет, что он свободен. */
create function public.assert_free(p_emp bigint, p_except bigint, p_self boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a requests;
begin
  perform 1 from employees where id = p_emp for update;
  a := public.active_request_of(p_emp, p_except);
  if a.id is not null then
    raise exception '% уже есть заявка в работе: %', case when p_self then 'У вас' else 'У мастера' end, public.request_label(a.number);
  end if;
end $$;

/** Мастер освободился: в работу встаёт следующая из очереди (вернули на доработку, затем отложенная из-за срочной). */
create function public.resume_next(p_emp bigint) returns void
language plpgsql security definer set search_path = public as $$
declare n requests;
begin
  if p_emp is null then return; end if;
  perform 1 from employees where id = p_emp for update;
  if (public.active_request_of(p_emp)).id is not null then return; end if;
  select * into n from requests
  where responsible_id = p_emp and status = 'paused' and is_open and hold_reason in ('returned', 'urgent')
  order by (hold_reason = 'returned') desc, paused_at, id
  limit 1 for update;
  if n.id is null then return; end if;
  update requests set status = 'in_work', hold_reason = null, hold_for = null, paused_at = null where id = n.id;
  perform public.log_request_event(n.id, 'resume', 'paused', 'in_work',
    case n.hold_reason when 'returned' then 'Снова в работе: вернули на доработку' else 'Снова в работе после срочной' end);
end $$;

-- ---------- Взять в работу ----------
create or replace function public.take_request(p_id bigint, p_plan_minutes integer, p_member_ids bigint[] default '{}'::bigint[])
returns void language plpgsql security definer set search_path = public as $function$
declare
  me bigint := public.current_employee_id();
  r requests;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if p_plan_minutes is not null and (p_plan_minutes < 15 or p_plan_minutes > 100000) then
    raise exception 'Примерное время: от 15 минут';
  end if;
  -- сначала — почему эту заявку вообще нельзя взять, потом — свободен ли мастер
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if not r.is_open then raise exception 'Заявка закрыта'; end if;
  if r.status = 'contractor' or r.to_contractor then raise exception 'Заявка у подрядчика'; end if;
  if r.responsible_id = me then raise exception 'Заявка уже у вас в работе'; end if;
  if r.responsible_id is not null then
    raise exception 'Заявку уже взял %', (select display_name from employees where id = r.responsible_id);
  end if;
  if r.assignee_id is not null and r.assignee_id <> me then
    raise exception 'Заявка назначена: %', (select display_name from employees where id = r.assignee_id);
  end if;
  if r.status <> 'waiting' then raise exception 'Заявку сейчас нельзя взять'; end if;
  perform public.assert_free(me, p_id, true);
  update requests set status = 'in_work', responsible_id = me, taken_at = now(),
                      plan_minutes = coalesce(p_plan_minutes, plan_minutes), returned_comment = null
  where id = p_id;
  delete from request_members where request_id = p_id;
  insert into request_members (request_id, employee_id)
  select p_id, e.id from employees e
  where e.id = any (coalesce(p_member_ids, '{}')) and e.id <> me and e.is_active and e.role = 'master';
  perform public.log_request_event(p_id, 'take', 'waiting', 'in_work',
    case when p_plan_minutes is not null then 'Примерно: ' || public.minutes_label(p_plan_minutes) end);
end $function$;

-- работы по свободной заявке в смене берут её — тоже только у свободного мастера
create or replace function public.claim_request_for_work(p_request bigint, p_author bigint)
returns void language plpgsql security definer set search_path = public as $function$
declare r requests;
begin
  select * into r from requests where id = p_request for update;
  if r.status = 'waiting' then
    if r.to_contractor then raise exception 'Заявка % у подрядчика', r.number; end if;
    if r.assignee_id is not null and r.assignee_id <> p_author then
      raise exception 'Заявка % назначена: %', r.number, (select display_name from employees where id = r.assignee_id);
    end if;
    perform public.assert_free(p_author, p_request, true);
    update requests set status = 'in_work', responsible_id = p_author, taken_at = now(), returned_comment = null
    where id = p_request;
    insert into request_events (request_id, kind, author_id, from_status, to_status)
    values (p_request, 'take', p_author, 'waiting', 'in_work');
  elsif r.status = 'contractor' then
    raise exception 'Заявка % у подрядчика', r.number;
  elsif r.status in ('in_work', 'review', 'paused') and r.responsible_id <> p_author then
    -- работы по заявке вносит только взявший её; напарники лишь числятся
    raise exception 'Заявку % взял %', r.number, (select display_name from employees where id = r.responsible_id);
  end if;
  -- accepted и свои in_work/review/paused — без изменений (правка смены в тот же день, время до приостановки)
end $function$;

-- своя заявка занятого мастера создаётся «Ожидает» с назначением на него — возьмёт следующей
create or replace function public.create_manual_request(p_title text, p_details text default null, p_assignee bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
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
end $function$;

-- ---------- Отправить, отказаться — мастер свободен ----------
create or replace function public.send_request_for_review(p_id bigint, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $function$
declare me bigint := public.current_employee_id();
begin
  if not exists (select 1 from requests where id = p_id and status = 'in_work' and responsible_id = me) then
    raise exception 'Отправить может только мастер, который взял заявку';
  end if;
  if not exists (select 1 from work_entries where request_id = p_id and status <> 'rejected')
     and not exists (select 1 from shift_requests where request_id = p_id and minutes > 0) then
    raise exception 'По заявке нет ни работ, ни времени';
  end if;
  update requests set status = 'review', sent_at = now(), returned_comment = null, pause_request = null, pause_requested_at = null
  where id = p_id;
  perform public.log_request_event(p_id, 'send', 'in_work', 'review', p_comment);
  perform public.resume_next(me);
end $function$;

create or replace function public.refuse_request(p_id bigint, p_comment text)
returns void language plpgsql security definer set search_path = public as $function$
declare me bigint := public.current_employee_id();
begin
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, почему отказываетесь'; end if;
  update requests set status = 'waiting', responsible_id = null, taken_at = null, returned_comment = null,
                      pause_request = null, pause_requested_at = null
  where id = p_id and status = 'in_work' and responsible_id = me;
  if not found then raise exception 'Отказаться может только мастер, который взял заявку'; end if;
  delete from request_members where request_id = p_id;
  perform public.log_request_event(p_id, 'refuse', 'in_work', 'waiting', p_comment);
  perform public.resume_next(me);
end $function$;

-- ---------- Вернуть на доработку: сразу в работу или первой в очередь ----------
create or replace function public.return_request(p_id bigint, p_comment text)
returns void language plpgsql security definer set search_path = public as $function$
declare r requests;
begin
  perform public.require_manager();
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, что исправить'; end if;
  select * into r from requests where id = p_id and status = 'review' for update;
  if r.id is null then raise exception 'Вернуть можно только заявку «На проверке»'; end if;
  perform 1 from employees where id = r.responsible_id for update;
  if r.is_open and (public.active_request_of(r.responsible_id, p_id)).id is not null then
    update requests set status = 'paused', hold_reason = 'returned', paused_at = now(), returned_comment = trim(p_comment) where id = p_id;
    perform public.log_request_event(p_id, 'return', 'review', 'paused', p_comment);
  else
    update requests set status = 'in_work', returned_comment = trim(p_comment) where id = p_id;
    perform public.log_request_event(p_id, 'return', 'review', 'in_work', p_comment);
  end if;
end $function$;

-- ---------- Назначить ответственного: срочная приостанавливает текущую, обычная — только свободному ----------
create or replace function public.set_request_responsible(p_id bigint, p_employee bigint)
returns void language plpgsql security definer set search_path = public as $function$
declare
  r requests;
  a requests;
  v_old bigint;
begin
  perform public.require_manager();
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if r.status in ('review', 'accepted') then raise exception 'Заявка уже отправлена на проверку'; end if;
  -- прежний ответственный освобождается, если заявка была у него активной
  v_old := case when r.status = 'in_work' and r.responsible_id is distinct from p_employee then r.responsible_id end;
  if p_employee is null then
    update requests set status = 'waiting', responsible_id = null, taken_at = null, to_contractor = false,
                        hold_reason = null, hold_for = null, paused_at = null, pause_request = null, pause_requested_at = null
    where id = p_id;
    delete from request_members where request_id = p_id;
    perform public.log_request_event(p_id, 'responsible', r.status, 'waiting', 'Снята с мастера');
  else
    if not exists (select 1 from employees where id = p_employee and is_active and role = 'master') then
      raise exception 'Мастер не найден';
    end if;
    perform 1 from employees where id = p_employee for update;
    a := public.active_request_of(p_employee, p_id);
    if a.id is not null and r.is_open then
      if r.priority = 1 then
        update requests set status = 'paused', hold_reason = 'urgent', hold_for = p_id, paused_at = now(),
                            pause_request = null, pause_requested_at = null
        where id = a.id;
        perform public.log_request_event(a.id, 'pause', 'in_work', 'paused', 'Из-за срочной ' || public.request_label(r.number));
      else
        raise exception 'У мастера уже есть заявка в работе: %. Обычную заявку можно назначить на него — возьмёт следующей; срочную — поставьте «Срочно».',
          public.request_label(a.number);
      end if;
    end if;
    update requests set status = 'in_work', responsible_id = p_employee,
                        taken_at = coalesce(case when r.responsible_id = p_employee then r.taken_at end, now()),
                        to_contractor = false, assignee_id = p_employee,
                        hold_reason = null, hold_for = null, paused_at = null, pause_request = null, pause_requested_at = null
    where id = p_id;
    delete from request_members where request_id = p_id and employee_id = p_employee;
    perform public.log_request_event(p_id, 'responsible', r.status, 'in_work',
      'Ответственный: ' || (select display_name from employees where id = p_employee));
  end if;
  perform public.resume_next(v_old);
end $function$;

create or replace function public.assign_request(p_id bigint, p_employee_id bigint, p_contractor boolean default false)
returns void language plpgsql security definer set search_path = public as $function$
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
    update requests set assignee_id = null, to_contractor = true, status = 'contractor', responsible_id = null, taken_at = null,
                        hold_reason = null, hold_for = null, paused_at = null, pause_request = null, pause_requested_at = null
    where id = p_id;
    delete from request_members where request_id = p_id;
    perform public.log_request_event(p_id, 'contractor', r.status, 'contractor');
    if r.status = 'in_work' then perform public.resume_next(r.responsible_id); end if;
  else
    update requests set assignee_id = p_employee_id, to_contractor = false,
                        status = case when r.status = 'contractor' then 'waiting' else r.status end
    where id = p_id;
    perform public.log_request_event(p_id, 'assign', r.status, case when r.status = 'contractor' then 'waiting' else r.status end,
      coalesce('Назначена: ' || (select display_name from employees where id = p_employee_id), 'Назначение снято'));
  end if;
end $function$;

-- закрыть заявку «В работе» — мастер свободен; открыть снова у занятого мастера — она встаёт приостановленной
create or replace function public.set_request_open(p_id bigint, p_open boolean)
returns void language plpgsql security definer set search_path = public as $function$
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
end $function$;

create or replace function public.close_old_requests(p_before date)
returns integer language plpgsql security definer set search_path = public as $function$
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
end $function$;

-- ---------- Приостановка: запрос мастера → решение руководителя; продолжить ----------
create function public.request_pause(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id();
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Напишите причину: чего ждёте'; end if;
  update requests set pause_request = left(trim(p_reason), 1000), pause_requested_at = now()
  where id = p_id and status = 'in_work' and responsible_id = me and is_open;
  if not found then raise exception 'Приостановить может только мастер, у которого заявка в работе'; end if;
  perform public.log_request_event(p_id, 'pause_request', 'in_work', 'in_work', p_reason);
end $$;

create function public.decide_pause(p_id bigint, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  perform public.require_manager();
  select * into r from requests where id = p_id for update;
  if r.id is null or r.pause_request is null or r.status <> 'in_work' then raise exception 'Запроса на приостановку нет'; end if;
  if p_approve then
    update requests set status = 'paused', hold_reason = 'pause', paused_at = now(), pause_request = null, pause_requested_at = null
    where id = p_id;
    perform public.log_request_event(p_id, 'pause', 'in_work', 'paused', coalesce(nullif(trim(p_comment), ''), r.pause_request));
    perform public.resume_next(r.responsible_id);
  else
    if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, почему нельзя приостановить'; end if;
    update requests set pause_request = null, pause_requested_at = null where id = p_id;
    perform public.log_request_event(p_id, 'pause_reject', 'in_work', 'in_work', p_comment);
  end if;
end $$;

create function public.resume_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_manager boolean := public.is_manager();
  r requests;
begin
  select * into r from requests where id = p_id for update;
  if r.id is null or r.status <> 'paused' or not r.is_open then raise exception 'Заявка не приостановлена'; end if;
  if not v_manager and r.responsible_id is distinct from me then raise exception 'Продолжить может мастер, у которого заявка'; end if;
  perform public.assert_free(r.responsible_id, p_id, not v_manager);
  update requests set status = 'in_work', hold_reason = null, hold_for = null, paused_at = null where id = p_id;
  perform public.log_request_event(p_id, 'resume', 'paused', 'in_work', null);
end $$;

-- ---------- Руководителю: кто чем занят сейчас ----------
create function public.masters_now() returns table (
  employee_id bigint, display_name text, request_id bigint, number text, operation text, priority smallint,
  taken_at timestamptz, spent_minutes integer, plan_minutes integer, pause_request text, paused integer, returned boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select e.id, e.display_name, r.id, r.number, coalesce(r.operation, r.subject), r.priority, r.taken_at,
           (select coalesce(sum(x.minutes), 0)::int from shift_requests x where x.request_id = r.id), r.plan_minutes,
           r.pause_request,
           (select count(*)::int from requests p where p.responsible_id = e.id and p.status = 'paused' and p.is_open),
           r.returned_comment is not null
    from employees e
    left join requests r on r.responsible_id = e.id and r.status = 'in_work' and r.is_open
    where e.is_active and e.role = 'master'
    order by r.id is null, r.taken_at, e.display_name;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.request_pause(bigint, text)', 'public.decide_pause(bigint, boolean, text)',
                           'public.resume_request(bigint)', 'public.masters_now()', 'public.request_label(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.active_request_of(bigint, bigint)', 'public.assert_free(bigint, bigint, boolean)',
                           'public.resume_next(bigint)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------- Списки и карточка: новые поля ----------
do $$
declare
  d text; n text; f text;
  pairs text[][] := array[
    -- мои заявки мастера: и приостановленные; сверху — активная, затем очередь
    array['public.my_requests()', 'unread integer, due_at timestamp without time zone)',
          'unread integer, due_at timestamp without time zone, hold_reason text, hold_number text, pause_request text)'],
    array['public.my_requests()', E'public.request_unread(r.id, public.current_employee_id(), false), r.due_at\n  from requests r',
          E'public.request_unread(r.id, public.current_employee_id(), false), r.due_at,\n         r.hold_reason, (select h.number from requests h where h.id = r.hold_for), r.pause_request\n  from requests r'],
    array['public.my_requests()', $r$where r.status in ('in_work', 'review') and r.is_open$r$,
          $r$where (r.status in ('in_work', 'review') or r.status = 'paused' and r.responsible_id = public.current_employee_id()) and r.is_open$r$],
    array['public.my_requests()', 'order by (r.returned_comment is not null) desc, r.status, r.priority, r.taken_at',
          $r$order by (r.status = 'in_work' and r.responsible_id = public.current_employee_id()) desc, (r.status = 'paused') desc,
           (r.hold_reason = 'returned') desc, (r.returned_comment is not null) desc, r.status, r.priority, r.taken_at$r$],
    -- руководителю: причина приостановки и запрос на неё; фильтр «Запросы на приостановку»
    array['public.list_requests(text, integer, text, text, smallint, bigint)', 'stale_days integer, due_at timestamp without time zone)',
          'stale_days integer, due_at timestamp without time zone, hold_reason text, hold_number text, pause_request text, pause_requested_at timestamp with time zone)'],
    array['public.list_requests(text, integer, text, text, smallint, bigint)', E'else 0 end, r.due_at\n    from requests r',
          E'else 0 end, r.due_at,\n           r.hold_reason, (select h.number from requests h where h.id = r.hold_for), r.pause_request, r.pause_requested_at\n    from requests r'],
    array['public.list_requests(text, integer, text, text, smallint, bigint)', 'and (p_lifecycle is null or r.status = p_lifecycle)',
          $r$and (p_lifecycle is null or r.status = p_lifecycle or p_lifecycle = 'pause_request' and r.pause_request is not null)$r$],
    array['public.list_requests(text, integer, text, text, smallint, bigint)', $r$order by r.is_open desc, (r.status = 'review') desc,$r$,
          $r$order by r.is_open desc, (r.pause_request is not null) desc, (r.status = 'review') desc,$r$],
    -- карточка: приостановка и активная заявка смотрящего (чтобы показать «сначала завершите …»)
    array['public.request_card(bigint, text)', $r$'taken_at', r.taken_at,$r$,
          $r$'taken_at', r.taken_at, 'hold_reason', r.hold_reason, 'paused_at', r.paused_at,
    'hold_number', (select h.number from requests h where h.id = r.hold_for),
    'pause_request', r.pause_request, 'pause_requested_at', r.pause_requested_at,
    'my_active', (select jsonb_build_object('id', a.id, 'number', a.number) from requests a
                  where a.responsible_id = me and a.status = 'in_work' and a.is_open limit 1),$r$],
    -- уведомления: мастеру — возвращённые и в очереди; руководителю — запросы на приостановку
    array['public.my_notifications()', $r$from requests r where r.status = 'in_work' and r.responsible_id = me and r.returned_comment is not null), '[]'::jsonb),$r$,
          $r$from requests r where r.status in ('in_work', 'paused') and r.responsible_id = me and r.returned_comment is not null and r.is_open), '[]'::jsonb),$r$],
    array['public.my_notifications()', $r$jsonb_build_object('id', r.id, 'number', r.number, 'comment', r.returned_comment))$r$,
          $r$jsonb_build_object('id', r.id, 'number', r.number, 'comment', r.returned_comment, 'queued', r.status = 'paused'))$r$],
    array['public.my_notifications()', $r$'stale', (select count(*)::int$r$,
          $r$'pause_requests', (select count(*)::int from requests r where r.pause_request is not null and r.is_open),
      'stale', (select count(*)::int$r$]
  ];
  i int;
  defs jsonb := '{}';
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := coalesce(defs ->> f, pg_get_functiondef(f::regprocedure));
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][2], f; end if;
    defs := defs || jsonb_build_object(f, n);
  end loop;
  for f in select jsonb_object_keys(defs) loop
    if f in ('public.my_requests()', 'public.list_requests(text, integer, text, text, smallint, bigint)') then
      execute 'drop function ' || f;
      execute defs ->> f;
      execute format('revoke all on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    else
      execute defs ->> f;
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
