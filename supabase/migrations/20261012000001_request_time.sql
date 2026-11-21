-- Время по заявкам, статус «Выполнено / Не закончено», перенос незаконченной заявки
-- на следующую смену, плановое время и статистика времени для руководителя.
-- Откат: supabase/rollback/20261012000001_request_time_down.sql

-- Длина смены. Если понадобится менять в приложении — вынести в настройки.
create or replace function public.shift_minutes() returns integer
language sql immutable as $$ select 480 $$;

-- ---------- Заявка: план и состояние ----------
alter table public.requests
  add column plan_minutes integer check (plan_minutes is null or plan_minutes between 15 and 100000),
  -- null — по заявке ещё не отмечали время (старые записи); open — не закончена; done — выполнена
  add column state text check (state in ('open', 'done')),
  add column manager_closed_at timestamptz;

-- ---------- Время по заявке за смену ----------
create table public.shift_requests (
  id         bigint generated always as identity primary key,
  shift_id   bigint not null references public.shifts (id) on delete cascade,
  request_id bigint references public.requests (id),          -- null — работы без заявки
  minutes    integer not null check (minutes between 0 and 1440 and minutes % 15 = 0),
  status     text check (status in ('done', 'unfinished')),
  check ((request_id is null) = (status is null))
);
create unique index shift_requests_uq on public.shift_requests (shift_id, coalesce(request_id, 0));
create index shift_requests_request_idx on public.shift_requests (request_id);

alter table public.shift_requests enable row level security;
revoke all on public.shift_requests from anon, authenticated;
-- читается только через функции ниже

create or replace function public.payload_has_time(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'array' and exists (
    select 1 from jsonb_array_elements(p) x where (x ->> 'minutes') ~ '^\d+$' and (x ->> 'minutes')::int > 0)
$$;

-- Состояние заявки — по последней по дате отметке мастера; ручное закрытие руководителем
-- держится, пока мастер не отметит заявку позже.
create or replace function public.refresh_request_state(p_request bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text; v_at timestamptz;
begin
  select sr.status, s.updated_at into v_status, v_at
  from shift_requests sr join shifts s on s.id = sr.shift_id
  where sr.request_id = p_request
  order by s.work_date desc, s.submitted_at desc, sr.id desc
  limit 1;
  update requests r
     set state = case
                   when r.manager_closed_at is not null and (v_at is null or r.manager_closed_at > v_at) then 'done'
                   when v_status is null then null
                   when v_status = 'unfinished' then 'open'
                   else 'done'
                 end
   where r.id = p_request;
end $$;

create or replace function public.save_shift_requests(p_shift bigint, p_requests jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old    bigint[];
  v_new    bigint[] := '{}';
  v_item   jsonb;
  v_num    text;
  v_req    bigint;
  v_min    integer;
  v_status text;
  v_author bigint := (select author_id from shifts where id = p_shift);
  v_total  integer := 0;
begin
  if p_requests is null then return; end if;
  if jsonb_typeof(p_requests) <> 'array' then raise exception 'Неверные данные времени'; end if;
  select array_agg(request_id) into v_old from shift_requests where shift_id = p_shift and request_id is not null;
  delete from shift_requests where shift_id = p_shift;

  for v_item in select * from jsonb_array_elements(p_requests) loop
    v_num := upper(nullif(trim(v_item ->> 'request_number'), ''));
    if (v_item ->> 'minutes') !~ '^\d+$' then raise exception 'Время: укажите количество минут'; end if;
    v_min := (v_item ->> 'minutes')::int;
    if v_min > 1440 or v_min % 15 <> 0 then raise exception 'Время: от 0 до 24 ч с шагом 15 минут'; end if;
    v_total := v_total + v_min;
    if v_num is null then
      v_req := null;
      v_status := null;
    else
      if v_num !~ '^(RFS|INC)\d{6}_\d{4}$' then raise exception 'Номер заявки % в неверном формате', v_num; end if;
      insert into requests (number, created_by) values (v_num, v_author) on conflict (number) do nothing;
      select id into v_req from requests where number = v_num;
      v_status := coalesce(v_item ->> 'status', 'done');
      if v_status not in ('done', 'unfinished') then raise exception 'Статус заявки: «Выполнено» или «Не закончено»'; end if;
    end if;
    if exists (select 1 from shift_requests where shift_id = p_shift and coalesce(request_id, 0) = coalesce(v_req, 0)) then
      raise exception 'Заявка % указана в смене дважды', coalesce(v_num, '«без заявки»');
    end if;
    insert into shift_requests (shift_id, request_id, minutes, status) values (p_shift, v_req, v_min, v_status);
    if v_req is not null then v_new := v_new || v_req; end if;
  end loop;
  if v_total > 1440 then raise exception 'Время за смену больше 24 часов'; end if;

  perform public.refresh_request_state(x) from unnest(coalesce(v_old, '{}') || v_new) x;
end $$;

create or replace function public.submit_shift(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me          bigint := public.current_employee_id();
  v_uuid      uuid;
  v_date      date;
  v_shift     shifts%rowtype;
  v_entry     jsonb;
  v_pos       int := 0;
  v_req_num   text;
  v_req_id    bigint;
  v_item      price_items%rowtype;
  v_unit      units%rowtype;
  v_qty       numeric;
  v_price     bigint;
  v_entry_id  bigint;
  v_perf      bigint[];
  v_emp       bigint;
  v_pending   int := 0;
  i           int;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  begin
    v_uuid := (payload ->> 'client_uuid')::uuid;
    v_date := (payload ->> 'work_date')::date;
  exception when others then
    raise exception 'Неверные данные смены';
  end;
  if v_uuid is null or v_date is null then raise exception 'Неверные данные смены'; end if;
  if jsonb_typeof(coalesce(payload -> 'entries', '[]')) <> 'array' then raise exception 'Неверные данные смены'; end if;
  -- смена без новых работ допустима, если мастер отметил время по заявке (продолжал перенесённую)
  if jsonb_array_length(coalesce(payload -> 'entries', '[]')) = 0 and not public.payload_has_time(payload -> 'requests') then
    raise exception 'В смене нет ни одной работы';
  end if;
  if jsonb_array_length(coalesce(payload -> 'entries', '[]')) > 100 then raise exception 'Слишком много работ в одной смене'; end if;

  select * into v_shift from shifts where client_uuid = v_uuid for update;
  if found then
    if v_shift.author_id <> me then raise exception 'Нет доступа' using errcode = '42501'; end if;
    if (v_shift.submitted_at at time zone public.app_timezone())::date <> public.app_today() and not public.is_manager() then
      raise exception 'Смену можно изменить только в день отправки. Обратитесь к руководителю.';
    end if;
    if exists (select 1 from work_entries e left join entry_money m on m.entry_id = e.id
               where e.shift_id = v_shift.id and (e.status = 'rejected' or m.price_source = 'manual')) then
      raise exception 'Руководитель уже обработал работы этой смены, изменить её нельзя.';
    end if;
  end if;

  if not public.is_manager() and v_date not in (public.app_today(), public.app_today() - 1) then
    raise exception 'Дата смены — сегодня или вчера';
  end if;

  if v_shift.id is null then
    insert into shifts (work_date, author_id, client_uuid) values (v_date, me, v_uuid) returning * into v_shift;
  else
    delete from work_entries where shift_id = v_shift.id;
    update shifts set work_date = v_date, updated_at = now() where id = v_shift.id;
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(payload -> 'entries', '[]')) loop
    v_pos := v_pos + 1;

    -- заявка: справочник пополняется номерами, которые вводят мастера
    v_req_id := null;
    v_req_num := upper(nullif(trim(v_entry ->> 'request_number'), ''));
    if v_req_num is not null then
      if v_req_num !~ '^(RFS|INC)\d{6}_\d{4}$' then
        raise exception 'Работа %: номер заявки % в неверном формате', v_pos, v_req_num;
      end if;
      insert into requests (number, created_by) values (v_req_num, me) on conflict (number) do nothing;
      select id into v_req_id from requests where number = v_req_num;
    end if;

    if not exists (select 1 from departments where id = (v_entry ->> 'department_id')::smallint and is_active) then
      raise exception 'Работа %: выберите отдел', v_pos;
    end if;

    begin
      v_qty := (v_entry ->> 'quantity')::numeric;
    exception when others then
      raise exception 'Работа %: объём должен быть числом', v_pos;
    end;
    if v_qty is null or v_qty <= 0 then raise exception 'Работа %: объём должен быть больше нуля', v_pos; end if;
    if v_qty <> round(v_qty, 3) then raise exception 'Работа %: не больше трёх знаков после запятой', v_pos; end if;

    if v_entry ? 'price_item_id' and v_entry ->> 'price_item_id' is not null then
      select * into v_item from price_items
      where id = (v_entry ->> 'price_item_id')::bigint and is_active and not is_material;
      if not found then raise exception 'Работа %: позиция прайса не найдена или выключена', v_pos; end if;
      select * into v_unit from units where id = v_item.unit_id;
      v_price := public.price_on(v_item.id, v_date);
      if v_price is null then raise exception 'Работа %: у позиции «%» нет цены на эту дату', v_pos, v_item.short_name; end if;
    else
      v_item := null;
      if length(trim(coalesce(v_entry ->> 'custom_name', ''))) < 3 then
        raise exception 'Работа %: введите название работы (не короче 3 букв)', v_pos;
      end if;
      select * into v_unit from units where id = (v_entry ->> 'unit_id')::smallint;
      if not found then raise exception 'Работа %: выберите единицу измерения', v_pos; end if;
      v_price := null;
    end if;
    if v_unit.integer_only and v_qty <> trunc(v_qty) then
      raise exception 'Работа %: для «%» объём должен быть целым числом', v_pos, v_unit.code;
    end if;

    -- исполнители: без повторов, только активные мастера
    select array_agg(distinct x::bigint) into v_perf
    from jsonb_array_elements_text(coalesce(v_entry -> 'performer_ids', '[]'::jsonb)) x;
    if v_perf is null or cardinality(v_perf) = 0 then raise exception 'Работа %: выберите исполнителя', v_pos; end if;
    if (select count(*) from employees where id = any (v_perf) and is_active and role in ('master', 'manager')) <> cardinality(v_perf) then
      raise exception 'Работа %: исполнитель не найден или отключён', v_pos;
    end if;

    insert into work_entries (shift_id, position, request_id, department_id, price_item_id, custom_name, unit_id, quantity, note, status)
    values (
      v_shift.id, v_pos, v_req_id, (v_entry ->> 'department_id')::smallint, v_item.id,
      case when v_item.id is null then trim(v_entry ->> 'custom_name') end,
      v_unit.id, v_qty, nullif(trim(v_entry ->> 'note'), ''),
      case when v_item.id is null then 'pending' else 'priced' end
    ) returning id into v_entry_id;

    -- порядок исполнителей как в запросе: первый получает остаток копеек
    i := 0;
    for v_emp in
      select x::bigint from jsonb_array_elements_text(v_entry -> 'performer_ids') with ordinality as t(x, n)
      group by x order by min(n)
    loop
      i := i + 1;
      insert into entry_performers (entry_id, employee_id, position, share)
      values (v_entry_id, v_emp, i, round(1.0 / cardinality(v_perf), 6));
    end loop;

    -- фото работы (до 3): файлы уже загружены приложением в хранилище
    perform public.attach_entry_photos(v_entry_id, v_entry -> 'photos', v_pos);

    if v_item.id is not null then
      insert into entry_money (entry_id, unit_price_kop, total_kop, price_source)
      values (v_entry_id, v_price, round(v_qty * v_price)::bigint, 'price_list');
      perform public.recompute_performer_money(v_entry_id);
    else
      v_pending := v_pending + 1;
    end if;
  end loop;

  -- время и статус по заявкам (старые версии приложения их не присылают — тогда не трогаем)
  perform public.save_shift_requests(v_shift.id, payload -> 'requests');

  return jsonb_build_object('shift_id', v_shift.id, 'entries', v_pos, 'pending', v_pending);
end $$;

-- Удаление смены целиком (руководителем) пересчитывает состояние заявок.
create or replace function public.shift_requests_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.request_id is not null then perform public.refresh_request_state(old.request_id); end if;
  return null;
end $$;
create trigger shift_requests_after_delete after delete on public.shift_requests
  for each row when (pg_trigger_depth() < 2) execute function public.shift_requests_after_delete();

-- ---------- Для мастера ----------
-- Незаконченные заявки, которые переходят к мастеру в следующую смену (без денег).
create or replace function public.my_open_requests()
returns table (number text, since date, last_date date, spent_minutes integer, entries integer, plan_minutes integer)
language sql stable security definer set search_path = public as $$
  with me as (select public.current_employee_id() as id),
  last as (
    select distinct on (sr.request_id) sr.request_id, s.author_id, sr.status
    from shift_requests sr join shifts s on s.id = sr.shift_id
    where sr.request_id is not null
    order by sr.request_id, s.work_date desc, s.submitted_at desc, sr.id desc
  )
  select r.number,
         (select min(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id),
         (select max(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id),
         (select coalesce(sum(x.minutes), 0)::int from shift_requests x where x.request_id = r.id),
         (select count(*)::int from work_entries e where e.request_id = r.id and e.status <> 'rejected'),
         r.plan_minutes
  from me
  join last l on l.author_id = me.id and l.status = 'unfinished'
  join requests r on r.id = l.request_id and r.state = 'open'
  order by 2, 1
$$;

-- План и уже потраченное время по номерам заявок (для подсказки «план 4 ч · потрачено 5 ч»).
-- p_exclude — смена, которую мастер сейчас правит: её время не считаем дважды.
create or replace function public.requests_time(p_numbers text[], p_exclude uuid default null)
returns table (number text, plan_minutes integer, spent_minutes integer, since date, state text)
language sql stable security definer set search_path = public as $$
  select r.number, r.plan_minutes,
         coalesce(sum(sr.minutes) filter (where s.client_uuid is distinct from p_exclude), 0)::int,
         min(s.work_date) filter (where s.client_uuid is distinct from p_exclude),
         r.state
  from requests r
  left join shift_requests sr on sr.request_id = r.id
  left join shifts s on s.id = sr.shift_id
  where public.current_employee_id() is not null and r.number = any (p_numbers)
  group by r.id
$$;

-- Время и статусы своей смены — для «Изменить смену».
create or replace function public.my_shift_requests(p_client_uuid uuid)
returns table (request_number text, minutes integer, status text)
language sql stable security definer set search_path = public as $$
  select r.number, sr.minutes, sr.status
  from shifts s
  join shift_requests sr on sr.shift_id = s.id
  left join requests r on r.id = sr.request_id
  where s.client_uuid = p_client_uuid and s.author_id = public.current_employee_id()
  order by sr.id
$$;

-- ---------- Для руководителя ----------
drop function public.list_requests(text, integer);
create function public.list_requests(q text default '', p_limit integer default 100)
returns table (id bigint, number text, subject text, entries bigint, last_work_date date,
               plan_minutes integer, spent_minutes integer, state text, carries integer, since date)
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
           (select min(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id)
    from requests r
    where public.search_words_match(public.normalize_search(r.number || ' ' || coalesce(r.subject, '')), q)
    order by 5 desc nulls last, r.created_at desc
    limit least(greatest(p_limit, 1), 300);
end $$;

-- Руководитель закрывает заявку сам (мастер в отпуске) или возвращает в работу.
create or replace function public.set_request_state(p_request bigint, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manager();
  if p_done then
    update requests set state = 'done', manager_closed_at = now() where id = p_request;
  else
    update requests set manager_closed_at = null where id = p_request;
    perform public.refresh_request_state(p_request);
    update requests set state = 'open' where id = p_request and state is distinct from 'open';
  end if;
end $$;

grant update (plan_minutes) on public.requests to authenticated;

-- Статистика времени за период.
-- «Задание» — выполненная заявка (последняя отметка в периоде) или работы без заявки за одну смену.
-- Время задания делится между его работами пропорционально стоимости (до оценки — поровну);
-- вид работ — категория прайса, у работ вне прайса — «Работы вне прайса».
-- Совместная работа: время задания засчитывается каждому исполнителю (время бригады).
create or replace function public.time_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.require_manager();
  with tr as (
    select sr.shift_id, sr.request_id, sr.minutes, sr.status, s.work_date
    from shift_requests sr join shifts s on s.id = sr.shift_id
  ),
  jobs as (
    select 'r' || r.id as job, r.id as request_id, null::bigint as shift_id, sum(t.minutes)::numeric as minutes
    from requests r join tr t on t.request_id = r.id
    where r.state = 'done'
    group by r.id
    having max(t.work_date) between p_from and p_to
    union all
    select 's' || t.shift_id, null, t.shift_id, t.minutes::numeric
    from tr t where t.request_id is null and t.work_date between p_from and p_to
  ),
  job_entries as (
    select j.job, e.id as entry_id, coalesce(p.category, 'Работы вне прайса') as kind, coalesce(m.total_kop, 0) as w
    from jobs j
    join work_entries e on (j.request_id is not null and e.request_id = j.request_id)
                        or (j.shift_id is not null and e.shift_id = j.shift_id and e.request_id is null)
    left join price_items p on p.id = e.price_item_id
    left join entry_money m on m.entry_id = e.id
    where e.status <> 'rejected' and not e.is_imported and j.minutes > 0
  ),
  shares as (
    select je.*, case when sum(je.w) over (partition by je.job) > 0
                      then je.w::numeric / sum(je.w) over (partition by je.job)
                      else 1.0 / count(*) over (partition by je.job) end as share
    from job_entries je
  ),
  job_kind as (
    select sh.job, sh.kind, sum(sh.share) * min(j.minutes) as minutes
    from shares sh join jobs j on j.job = sh.job
    group by sh.job, sh.kind
  ),
  kinds as (
    select kind, count(*) as jobs, avg(minutes) as avg_min,
           percentile_cont(0.5) within group (order by minutes) as median_min
    from job_kind group by kind
  ),
  part as (
    select distinct je.job, ep.employee_id
    from job_entries je join entry_performers ep on ep.entry_id = je.entry_id
  ),
  masters as (
    select pt.employee_id, emp.display_name,
           count(distinct pt.job) filter (where pt.job like 'r%') as requests,
           count(distinct pt.job) as jobs,
           sum(jk.minutes) as minutes, sum(k.avg_min) as expected
    from part pt
    join employees emp on emp.id = pt.employee_id and emp.role = 'master'
    join job_kind jk on jk.job = pt.job
    join kinds k on k.kind = jk.kind
    group by pt.employee_id, emp.display_name
  ),
  activity as (
    select r.id, r.number, r.plan_minutes, r.state, sum(t.minutes)::int as spent,
           min(t.work_date) as since, max(t.work_date) as last_date,
           count(*) filter (where t.status = 'unfinished') as carries
    from requests r join tr t on t.request_id = r.id
    group by r.id
    having max(t.work_date) >= p_from and min(t.work_date) <= p_to
  )
  select jsonb_build_object(
    'kinds', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'jobs', jobs,
                         'avg_minutes', round(avg_min), 'median_minutes', round(median_min::numeric)) order by avg_min desc) from kinds), '[]'),
    'masters', coalesce((select jsonb_agg(jsonb_build_object('employee_id', employee_id, 'display_name', display_name,
                         'requests', requests, 'jobs', jobs, 'minutes', round(minutes), 'expected_minutes', round(expected),
                         'ratio', case when expected > 0 then round(minutes / expected, 3) end) order by display_name) from masters), '[]'),
    'over_plan', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'plan_minutes', plan_minutes,
                         'spent_minutes', spent, 'state', state, 'since', since, 'last_date', last_date) order by spent - plan_minutes desc)
                         from activity where plan_minutes is not null and spent > plan_minutes), '[]'),
    'requests', (select count(*) from activity),
    'carried', (select count(*) from activity where carries > 0),
    'done', (select count(*) from activity where state = 'done'),
    'minutes', (select coalesce(sum(t.minutes), 0) from tr t where t.work_date between p_from and p_to)
  ) into res;
  return res;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.my_open_requests()',
    'public.requests_time(text[], uuid)',
    'public.my_shift_requests(uuid)',
    'public.list_requests(text, integer)',
    'public.set_request_state(bigint, boolean)',
    'public.time_stats(date, date)',
    'public.shift_minutes()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.save_shift_requests(bigint, jsonb)',
    'public.refresh_request_state(bigint)',
    'public.shift_requests_after_delete()',
    'public.payload_has_time(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
