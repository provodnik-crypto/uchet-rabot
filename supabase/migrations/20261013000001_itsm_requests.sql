-- Заявки из выгрузки ITSM. Руководитель загружает файл Excel, телефон разбирает и обезличивает его
-- в памяти, в базу приходят только очищенные строки. Мастер выбирает заявку из списка.
-- * магазины (код из рабочей группы L2-MAG-031 → 031);
-- * производственный календарь: окно загрузки по умолчанию — прошлый рабочий день;
-- * журнал загрузок без содержимого файла;
-- * назначение заявки сотруднику или подрядчику, закрытие только руководителем.

-- ---------- Магазины ----------
create table public.stores (
  id         smallint generated always as identity primary key,
  code       text not null unique check (code ~ '^\d{3}$'),
  name       text not null check (length(trim(name)) between 1 and 60),
  is_active  boolean not null default true
);
insert into public.stores (code, name) values ('031', 'Тюмень 1');

create function public.default_store_id() returns smallint
language sql stable security definer set search_path = public as $$
  select id from stores where is_active order by id limit 1
$$;

alter table public.employees add column store_id smallint references public.stores (id) default public.default_store_id();
update public.employees set store_id = public.default_store_id() where store_id is null;

alter table public.stores enable row level security;
create policy stores_select on public.stores for select to authenticated using (true);
revoke all on public.stores from anon, authenticated;
grant select on public.stores to authenticated;
grant select (store_id) on public.employees to authenticated;

-- ---------- Производственный календарь ----------
-- Здесь только исключения: праздники в будни (false) и рабочие субботы (true).
create table public.work_calendar (
  day         date primary key,
  is_workday  boolean not null,
  note        text
);
insert into public.work_calendar (day, is_workday, note) values
  -- 2026 (постановление Правительства РФ от 24.09.2025 № 1466)
  ('2026-01-01', false, 'Новогодние каникулы'), ('2026-01-02', false, 'Новогодние каникулы'),
  ('2026-01-05', false, 'Новогодние каникулы'), ('2026-01-06', false, 'Новогодние каникулы'),
  ('2026-01-07', false, 'Рождество'),           ('2026-01-08', false, 'Новогодние каникулы'),
  ('2026-01-09', false, 'Перенос с 3 января'),  ('2026-02-23', false, 'День защитника Отечества'),
  ('2026-03-09', false, 'Перенос с 8 марта'),   ('2026-05-01', false, 'Праздник Весны и Труда'),
  ('2026-05-11', false, 'Перенос с 9 мая'),     ('2026-06-12', false, 'День России'),
  ('2026-11-04', false, 'День народного единства'), ('2026-12-31', false, 'Перенос с 4 января'),
  -- 2027 (постановление Правительства РФ от 17.09.2026 № 1187)
  ('2027-01-01', false, 'Новогодние каникулы'), ('2027-01-04', false, 'Новогодние каникулы'),
  ('2027-01-05', false, 'Новогодние каникулы'), ('2027-01-06', false, 'Новогодние каникулы'),
  ('2027-01-07', false, 'Рождество'),           ('2027-01-08', false, 'Новогодние каникулы'),
  ('2027-02-20', true,  'Рабочая суббота, перенос на 22 февраля'),
  ('2027-02-22', false, 'Перенос с 20 февраля'), ('2027-02-23', false, 'День защитника Отечества'),
  ('2027-03-08', false, 'Международный женский день'), ('2027-05-03', false, 'Перенос с 1 мая'),
  ('2027-05-10', false, 'Перенос с 9 мая'),     ('2027-06-14', false, 'Перенос с 12 июня'),
  ('2027-11-04', false, 'День народного единства'), ('2027-11-05', false, 'Перенос с 2 января'),
  ('2027-12-31', false, 'Перенос с 3 января');

alter table public.work_calendar enable row level security;
create policy work_calendar_select on public.work_calendar for select to authenticated using (true);
revoke all on public.work_calendar from anon, authenticated;
grant select on public.work_calendar to authenticated;

create function public.is_workday(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select c.is_workday from work_calendar c where c.day = d), extract(isodow from d) < 6)
$$;

-- Ближайший рабочий день до d (не включая d).
create function public.prev_workday(d date) returns date
language plpgsql stable security definer set search_path = public as $$
declare x date := d - 1;
begin
  while not public.is_workday(x) and x > d - 60 loop
    x := x - 1;
  end loop;
  return x;
end $$;

create function public.store_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Yekaterinburg')::date $$;

-- ---------- Журнал загрузок: кто, когда, сколько. Содержимого файла нет. ----------
create table public.request_imports (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  created_by       bigint not null references public.employees (id),
  window_from      date,
  window_to        date,
  file_rows        integer not null check (file_rows >= 0),
  new_rows         integer not null check (new_rows >= 0),
  existing_rows    integer not null check (existing_rows >= 0),
  outside_rows     integer not null check (outside_rows >= 0),   -- новые, но вне окна и не загружены
  error_rows       integer not null check (error_rows >= 0),
  closed_rows      integer not null check (closed_rows >= 0)
);
alter table public.request_imports enable row level security;
create policy request_imports_select on public.request_imports for select to authenticated using (public.is_manager());
revoke all on public.request_imports from anon, authenticated;
grant select on public.request_imports to authenticated;

-- ---------- Заявки: поля из ITSM ----------
alter table public.requests
  add column source         text not null default 'manual' check (source in ('manual', 'itsm')),
  add column store_id       smallint references public.stores (id),
  add column service        text check (service is null or length(service) <= 200),
  add column operation      text check (operation is null or length(operation) <= 200),
  add column description    text check (description is null or length(description) <= 1000),
  add column itsm_status    text check (itsm_status is null or length(itsm_status) <= 60),
  add column registered_at  timestamp,                       -- как в файле ITSM (местное время)
  -- «Имя Ф. (ldap)» или служебная учётка «rr13.mag031»
  add column requester      text check (requester is null
                              or requester ~ '^[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z-]* [А-ЯЁA-Z]\. \(\d{3,12}\)$'
                              or requester ~ '^[a-z0-9_-]+\.[a-z0-9_-]+$'),
  add column is_open        boolean not null default true,
  add column closed_at      timestamptz,
  add column closed_by      bigint references public.employees (id),
  add column assignee_id    bigint references public.employees (id),
  add column to_contractor  boolean not null default false,
  add column import_id      bigint references public.request_imports (id),
  add constraint requests_assign_one check (not (to_contractor and assignee_id is not null)),
  -- последняя защита: телефонов и почт в описании быть не должно
  add constraint requests_description_clean check (description is null or (
        description !~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+'
    and description !~ '(^|\D)(\+7|8)?[\s(-]*\d{3}[\s)-]{0,2}\d{3}[\s-]?\d{2}[\s-]?\d{2}($|\D)'));
create index requests_open_idx on public.requests (store_id, registered_at desc) where is_open and source = 'itsm';

-- Мастер читает заявки, но не заявителя (в нём номер ldap): только через open_requests, «Имя Ф.».
revoke select on public.requests from authenticated;
grant select (id, number, subject, created_by, created_at, source, store_id, service, operation, description,
              itsm_status, registered_at, is_open, closed_at, assignee_id, to_contractor)
  on public.requests to authenticated;

-- «Имя Ф. (60035226)» → «Имя Ф.»; служебная учётка остаётся как есть.
create function public.requester_short(r text) returns text
language sql immutable as $$ select nullif(trim(regexp_replace(coalesce(r, ''), '\s*\(\d+\)$', '')), '') $$;

-- ---------- Окно дат по умолчанию ----------
-- Прошлый рабочий день и выходные/праздники после него (до вчера включительно): в понедельник —
-- пятница, суббота, воскресенье. Если загрузку пропустили — со дня после прошлой загрузки.
-- Первая загрузка (p_last is null) — без ограничения.
create function public.import_window(p_today date, p_last date, out window_from date, out window_to date)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_last is null then return; end if;
  window_from := public.prev_workday(p_today);
  if p_last + 1 < window_from then window_from := p_last + 1; end if;
  window_to := p_today - 1;
end $$;

-- ---------- Предпросмотр загрузки ----------
-- p_numbers — все номера из файла. Ответ: какие уже есть, какие открытые пропали из файла,
-- окно дат по умолчанию, справочник магазинов.
create function public.request_import_context(p_numbers text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
end $$;

-- ---------- Загрузка ----------
-- p: {rows: [{number, store_code, service, operation, description, status, registered_at, requester}],
--     close_ids: [..], window_from, window_to, file_rows, existing_rows, outside_rows, error_rows}
-- Новые номера добавляются, существующие не меняются. Всё в одной транзакции.
create function public.request_import_apply(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
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
                          registered_at, requester, created_by, import_id)
    select x ->> 'number', 'itsm', s.id,
           nullif(trim(x ->> 'service'), ''), nullif(trim(x ->> 'operation'), ''),
           nullif(trim(x ->> 'description'), ''), nullif(trim(x ->> 'operation'), ''),
           nullif(trim(x ->> 'status'), ''), (x ->> 'registered_at')::timestamp,
           nullif(trim(x ->> 'requester'), ''), me, v_import
    from jsonb_array_elements(p -> 'rows') x
    join stores s on s.code = x ->> 'store_code'
    on conflict (number) do nothing
    returning 1
  )
  select count(*) into v_new from ins;

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
end $$;

-- ---------- Назначение и закрытие (руководитель) ----------
create function public.assign_request(p_id bigint, p_employee_id bigint, p_contractor boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manager();
  if p_employee_id is not null and not exists (
    select 1 from employees where id = p_employee_id and is_active and role in ('master', 'manager')
  ) then raise exception 'Сотрудник не найден'; end if;
  update requests set assignee_id = case when coalesce(p_contractor, false) then null else p_employee_id end,
                      to_contractor = coalesce(p_contractor, false)
  where id = p_id;
  if not found then raise exception 'Заявка не найдена'; end if;
end $$;

create function public.set_request_open(p_id bigint, p_open boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manager();
  update requests set is_open = p_open,
                      closed_at = case when p_open then null else now() end,
                      closed_by = case when p_open then null else public.current_employee_id() end
  where id = p_id;
  if not found then raise exception 'Заявка не найдена'; end if;
end $$;

-- ---------- Открытые заявки магазина (мастер и руководитель) ----------
-- p_filter: all | mine | contractor. Сначала назначенные мне, потом свежие.
create function public.open_requests(q text default '', p_filter text default 'all', p_limit integer default 300)
returns table (id bigint, number text, service text, operation text, description text, registered_at timestamp,
               requester_name text, assignee_id bigint, assignee_name text, to_contractor boolean, mine boolean)
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
           coalesce(r.assignee_id = me, false)
    from requests r
    left join employees a on a.id = r.assignee_id
    where r.source = 'itsm' and r.is_open and r.store_id = v_store
      and (p_filter is distinct from 'mine' or r.assignee_id = me)
      and (p_filter is distinct from 'contractor' or r.to_contractor)
      and public.search_words_match(public.normalize_search(
            r.number || ' ' || coalesce(r.operation, '') || ' ' || coalesce(r.description, '') || ' ' || coalesce(r.service, '')), q)
    order by coalesce(r.assignee_id = me, false) desc, r.registered_at desc nulls last, r.id desc
    limit least(greatest(p_limit, 1), 500);
end $$;

-- ---------- Список заявок руководителя: с полями ITSM ----------
drop function public.list_requests(text, integer);
create function public.list_requests(q text default '', p_limit integer default 100)
returns table (id bigint, number text, subject text, entries bigint, last_work_date date,
               source text, service text, operation text, description text, itsm_status text,
               registered_at timestamp, requester text, is_open boolean, assignee_id bigint,
               assignee_name text, to_contractor boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select r.id, r.number, r.subject, count(e.id), max(s.work_date),
           r.source, r.service, r.operation, r.description, r.itsm_status,
           r.registered_at, r.requester, r.is_open, r.assignee_id, a.display_name, r.to_contractor
    from requests r
    left join work_entries e on e.request_id = r.id
    left join shifts s on s.id = e.shift_id
    left join employees a on a.id = r.assignee_id
    where public.search_words_match(public.normalize_search(
            r.number || ' ' || coalesce(r.subject, '') || ' ' || coalesce(r.operation, '') || ' ' || coalesce(r.description, '')), q)
    group by r.id, a.display_name
    order by r.is_open desc, greatest(max(s.work_date)::timestamp, r.registered_at, r.created_at::timestamp) desc nulls last
    limit least(greatest(p_limit, 1), 300);
end $$;

-- ---------- Права на функции ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.default_store_id()',
    'public.is_workday(date)',
    'public.prev_workday(date)',
    'public.store_today()',
    'public.import_window(date, date)',
    'public.requester_short(text)',
    'public.request_import_context(text[])',
    'public.request_import_apply(jsonb)',
    'public.assign_request(bigint, bigint, boolean)',
    'public.set_request_open(bigint, boolean)',
    'public.open_requests(text, text, integer)',
    'public.list_requests(text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
