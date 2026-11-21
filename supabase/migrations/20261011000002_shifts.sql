-- Этап 3: смены мастеров, работы, исполнители, заявки.
-- Мастер пишет только через submit_shift: функция сама подставляет цену из прайса
-- и кладёт деньги в entry_money / performer_money, которые мастеру недоступны.

-- ---------- Заявки ----------
create table public.requests (
  id             bigint generated always as identity primary key,
  number         text not null unique check (number ~ '^(RFS|INC)\d{6}_\d{4}$'),
  requester      text,
  registered_at  date,
  subject        text,
  state          text,
  note           text,
  created_by     bigint references public.employees (id),
  created_at     timestamptz not null default now()
);

-- ---------- Смены и работы ----------
create table public.shifts (
  id            bigint generated always as identity primary key,
  work_date     date not null,
  author_id     bigint not null references public.employees (id),
  client_uuid   uuid not null unique,               -- защита от двойной отправки
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index shifts_author_idx on public.shifts (author_id, work_date desc);

create table public.work_entries (
  id              bigint generated always as identity primary key,
  shift_id        bigint not null references public.shifts (id) on delete cascade,
  position        smallint not null,
  request_id      bigint references public.requests (id),
  department_id   smallint not null references public.departments (id),
  price_item_id   bigint references public.price_items (id),
  custom_name     text check (custom_name is null or length(trim(custom_name)) between 3 and 200),
  unit_id         smallint not null references public.units (id),
  quantity        numeric(12, 3) not null check (quantity > 0),
  note            text check (note is null or length(note) <= 500),
  -- priced — цена есть; pending — работа вне прайса ждёт оценки; rejected — отклонена руководителем
  status          text not null check (status in ('priced', 'pending', 'rejected')),
  reject_comment  text,
  is_imported     boolean not null default false,
  created_at      timestamptz not null default now(),
  check ((price_item_id is null) <> (custom_name is null))  -- либо из прайса, либо своё название
);
create index work_entries_shift_idx on public.work_entries (shift_id);
create index work_entries_status_idx on public.work_entries (status) where status <> 'priced';

-- Для «шт» объём только целый.
create or replace function public.check_entry_quantity() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select integer_only from units where id = new.unit_id) and new.quantity <> trunc(new.quantity) then
    raise exception 'Для единицы «%» объём должен быть целым числом', (select code from units where id = new.unit_id)
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger work_entries_quantity before insert or update of quantity, unit_id on public.work_entries
  for each row execute function public.check_entry_quantity();

create table public.entry_performers (
  entry_id     bigint not null references public.work_entries (id) on delete cascade,
  employee_id  bigint not null references public.employees (id),
  position     smallint not null,                    -- 1 — первый исполнитель, ему остаток копеек
  share        numeric(9, 6) not null check (share > 0 and share <= 1),
  primary key (entry_id, employee_id),
  unique (entry_id, position)
);
create index entry_performers_employee_idx on public.entry_performers (employee_id);

-- ---------- Деньги (только руководитель) ----------
create table public.entry_money (
  entry_id        bigint primary key references public.work_entries (id) on delete cascade,
  unit_price_kop  bigint not null check (unit_price_kop > 0),
  total_kop       bigint not null check (total_kop > 0),
  price_source    text not null check (price_source in ('price_list', 'manual', 'import')),
  priced_by       bigint references public.employees (id),
  priced_at       timestamptz not null default now()
);

create table public.performer_money (
  entry_id     bigint not null references public.work_entries (id) on delete cascade,
  employee_id  bigint not null references public.employees (id),
  share_kop    bigint not null check (share_kop >= 0),
  primary key (entry_id, employee_id)
);

-- Делит сумму работы между исполнителями по долям. Копейки округления — первому исполнителю,
-- поэтому сумма долей всегда равна полной стоимости.
create or replace function public.recompute_performer_money(p_entry bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_total bigint;
begin
  delete from performer_money where entry_id = p_entry;
  select total_kop into v_total from entry_money where entry_id = p_entry;
  if v_total is null then return; end if;
  insert into performer_money (entry_id, employee_id, share_kop)
  select p.entry_id, p.employee_id,
         floor(v_total * p.share / s.total_share)::bigint
         + case when p.position = min(p.position) over () then
             v_total - sum(floor(v_total * p.share / s.total_share)::bigint) over ()
           else 0 end
  from entry_performers p
  cross join (select sum(share) as total_share from entry_performers where entry_id = p_entry) s
  where p.entry_id = p_entry;
end $$;

-- ---------- Доступ ----------
-- Мастер видит работу, если он её исполнитель или автор смены.
create or replace function public.can_see_entry(p_entry bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or exists (
    select 1 from work_entries e join shifts s on s.id = e.shift_id
    where e.id = p_entry and (
      s.author_id = public.current_employee_id()
      or exists (select 1 from entry_performers p where p.entry_id = e.id and p.employee_id = public.current_employee_id())
    )
  )
$$;

alter table public.requests enable row level security;
alter table public.shifts enable row level security;
alter table public.work_entries enable row level security;
alter table public.entry_performers enable row level security;
alter table public.entry_money enable row level security;
alter table public.performer_money enable row level security;

create policy requests_select on public.requests for select to authenticated using (true);
create policy shifts_select on public.shifts for select to authenticated using (
  public.is_manager() or author_id = public.current_employee_id()
  or exists (select 1 from work_entries e join entry_performers p on p.entry_id = e.id
             where e.shift_id = shifts.id and p.employee_id = public.current_employee_id())
);
create policy work_entries_select on public.work_entries for select to authenticated using (public.can_see_entry(id));
create policy entry_performers_select on public.entry_performers for select to authenticated using (public.can_see_entry(entry_id));
create policy entry_money_select on public.entry_money for select to authenticated using (public.is_manager());
create policy performer_money_select on public.performer_money for select to authenticated using (public.is_manager());

-- Запись — только через функции ниже.
revoke all on public.requests, public.shifts, public.work_entries, public.entry_performers,
  public.entry_money, public.performer_money from anon, authenticated;
grant select on public.requests, public.shifts, public.work_entries, public.entry_performers,
  public.entry_money, public.performer_money to authenticated;

-- ---------- Отправка смены ----------
-- payload: {client_uuid, work_date, entries: [{request_number, department_id, price_item_id | custom_name + unit_id,
--           quantity, note, performer_ids: [..]}]}
-- Повторная отправка с тем же client_uuid заменяет работы смены (обрыв связи, правка до конца дня).
-- Ответ без денег: {shift_id, entries, pending}.
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
  if jsonb_typeof(payload -> 'entries') <> 'array' or jsonb_array_length(payload -> 'entries') = 0 then
    raise exception 'В смене нет ни одной работы';
  end if;
  if jsonb_array_length(payload -> 'entries') > 100 then raise exception 'Слишком много работ в одной смене'; end if;

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

  for v_entry in select * from jsonb_array_elements(payload -> 'entries') loop
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

    if v_item.id is not null then
      insert into entry_money (entry_id, unit_price_kop, total_kop, price_source)
      values (v_entry_id, v_price, round(v_qty * v_price)::bigint, 'price_list');
      perform public.recompute_performer_money(v_entry_id);
    else
      v_pending := v_pending + 1;
    end if;
  end loop;

  return jsonb_build_object('shift_id', v_shift.id, 'entries', v_pos, 'pending', v_pending);
end $$;

-- ---------- Чтение для мастера (без денег) ----------
-- Работы, где я исполнитель или автор смены, за последние p_days дней.
create or replace function public.my_entries(p_days integer default 60)
returns table (
  shift_id bigint, client_uuid uuid, work_date date, submitted_at timestamptz, can_edit boolean,
  entry_id bigint, entry_position smallint, request_number text, department_id smallint, department_name text,
  price_item_id bigint, name text, category text, is_custom boolean, unit_id smallint, unit_code text,
  integer_only boolean, quantity numeric, note text, status text, reject_comment text, performer_ids bigint[], performer_names text
)
language sql stable security definer set search_path = public as $$
  with me as (select public.current_employee_id() as id)
  select s.id, case when s.author_id = me.id then s.client_uuid end, s.work_date, s.submitted_at,
         s.author_id = me.id
           and (s.submitted_at at time zone public.app_timezone())::date = public.app_today()
           and not exists (select 1 from work_entries e2 left join entry_money m on m.entry_id = e2.id
                           where e2.shift_id = s.id and (e2.status = 'rejected' or m.price_source = 'manual')),
         e.id, e.position, r.number, d.id, d.name,
         e.price_item_id, coalesce(p.short_name, e.custom_name), p.category, e.price_item_id is null, u.id, u.code,
         u.integer_only, e.quantity, e.note, e.status, e.reject_comment,
         (select array_agg(ep.employee_id order by ep.position) from entry_performers ep where ep.entry_id = e.id),
         (select string_agg(emp.display_name, ', ' order by ep.position)
            from entry_performers ep join employees emp on emp.id = ep.employee_id where ep.entry_id = e.id)
  from me
  join shifts s on true
  join work_entries e on e.shift_id = s.id
  join departments d on d.id = e.department_id
  join units u on u.id = e.unit_id
  left join price_items p on p.id = e.price_item_id
  left join requests r on r.id = e.request_id
  where me.id is not null
    and s.work_date >= public.app_today() - greatest(p_days, 1)
    and not e.is_imported
    and (s.author_id = me.id or exists (select 1 from entry_performers ep where ep.entry_id = e.id and ep.employee_id = me.id))
  order by s.work_date desc, s.submitted_at desc, e.position
$$;

-- Последние номера заявок, которые вводил этот мастер.
create or replace function public.my_recent_requests(p_limit integer default 8)
returns table (number text)
language sql stable security definer set search_path = public as $$
  select r.number
  from work_entries e join shifts s on s.id = e.shift_id join requests r on r.id = e.request_id
  where s.author_id = public.current_employee_id()
  group by r.number
  order by max(s.submitted_at) desc
  limit least(greatest(p_limit, 1), 20)
$$;

-- Часто и недавно выбираемые работы из прайса (по моим работам).
create or replace function public.my_price_items(p_mode text default 'frequent', p_limit integer default 15)
returns table (id bigint, short_name text, category text, subcategory text, unit_id smallint, unit_code text, integer_only boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.short_name, p.category, p.subcategory, u.id, u.code, u.integer_only
  from work_entries e
  join shifts s on s.id = e.shift_id
  join price_items p on p.id = e.price_item_id and p.is_active and not p.is_material
  join units u on u.id = p.unit_id
  where s.author_id = public.current_employee_id()
     or exists (select 1 from entry_performers ep where ep.entry_id = e.id and ep.employee_id = public.current_employee_id())
  group by p.id, u.id
  order by case when p_mode = 'recent' then extract(epoch from max(s.submitted_at)) else count(*) end desc, p.short_name
  limit least(greatest(p_limit, 1), 50)
$$;

-- Подсказки при вводе работы вне прайса: похожие позиции прайса и ранее оценённые работы (только названия).
create or replace function public.suggest_custom_names(q text)
returns table (kind text, price_item_id bigint, name text, category text, unit_id smallint, unit_code text)
language sql stable security definer set search_path = public as $$
  (select 'price', s.id, s.short_name, s.category, s.unit_id, s.unit_code
   from public.search_price_items(q, null, null, 5) s
   where length(trim(q)) >= 3)
  union all
  (select 'custom', null::bigint, c.custom_name, null::text, c.unit_id, u.code
   from (
     select distinct on (public.normalize_search(e.custom_name)) e.custom_name, e.unit_id, e.created_at
     from work_entries e
     where e.custom_name is not null and e.status = 'priced'
       and public.search_words_match(public.normalize_search(e.custom_name), q)
     order by public.normalize_search(e.custom_name), e.created_at desc
   ) c join units u on u.id = c.unit_id
   where length(trim(q)) >= 3
   order by c.created_at desc
   limit 5)
$$;

revoke all on function public.recompute_performer_money(bigint) from public, anon, authenticated;
revoke all on function public.can_see_entry(bigint) from public, anon;
revoke all on function public.submit_shift(jsonb) from public, anon;
revoke all on function public.my_entries(integer) from public, anon;
revoke all on function public.my_recent_requests(integer) from public, anon;
revoke all on function public.my_price_items(text, integer) from public, anon;
revoke all on function public.suggest_custom_names(text) from public, anon;
revoke all on function public.check_entry_quantity() from public, anon, authenticated;
grant execute on function public.can_see_entry(bigint) to authenticated;
grant execute on function public.submit_shift(jsonb) to authenticated;
grant execute on function public.my_entries(integer) to authenticated;
grant execute on function public.my_recent_requests(integer) to authenticated;
grant execute on function public.my_price_items(text, integer) to authenticated;
grant execute on function public.suggest_custom_names(text) to authenticated;
