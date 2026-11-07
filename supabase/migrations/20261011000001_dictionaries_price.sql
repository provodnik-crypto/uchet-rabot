-- Этап 2: единицы, отделы, прайс с историей цен.
-- Цены лежат в отдельной таблице price_item_prices, которую видит только руководитель:
-- на устройство мастера цены не приходят ни в одном ответе сервера.

-- Поиск без учёта регистра и разницы «ё/е».
create or replace function public.normalize_search(t text) returns text
language sql immutable parallel safe as $$
  select lower(replace(replace(coalesce(t, ''), 'ё', 'е'), 'Ё', 'Е'))
$$;

-- Каждое слово запроса должно встречаться в тексте (в любом порядке).
create or replace function public.search_words_match(hay text, q text) returns boolean
language sql immutable parallel safe as $$
  select coalesce(bool_and(strpos(hay, w) > 0), true)
  from unnest(regexp_split_to_array(public.normalize_search(trim(q)), '\s+')) as w
  where w <> ''
$$;

-- ---------- Единицы измерения ----------
create table public.units (
  id            smallint generated always as identity primary key,
  code          text not null unique,
  integer_only  boolean not null default false,  -- для «шт» объём только целый
  sort          smallint not null
);

insert into public.units (code, integer_only, sort) values
  ('шт', true, 1), ('м²', false, 2), ('м', false, 3), ('м³', false, 4),
  ('т', false, 5), ('кг', false, 6), ('км', false, 7), ('ч', false, 8), ('чел.-ч', false, 9);

-- ---------- Отделы ----------
create table public.departments (
  id          smallint generated always as identity primary key,
  name        text not null check (length(trim(name)) between 1 and 40),
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  sort        smallint not null default 100,
  created_at  timestamptz not null default now(),
  check (is_active or not is_default)  -- отдел по умолчанию нельзя выключить
);
-- «Плитка» и «плитка» — один отдел.
create unique index departments_name_uq on public.departments (lower(trim(name)));
create unique index departments_one_default on public.departments (is_default) where is_default;

insert into public.departments (name, is_default, sort) values
  ('Магазин', true, 1), ('Плитка', false, 2), ('Декор', false, 3), ('Сантехника', false, 4),
  ('Водоснабжение', false, 5), ('Электротовары', false, 6), ('Электроинструменты', false, 7);

-- Сменить отдел по умолчанию одним действием.
create or replace function public.set_default_department(p_id smallint) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Доступно только руководителю' using errcode = '42501'; end if;
  if not exists (select 1 from departments where id = p_id and is_active) then
    raise exception 'Отдел не найден или выключен';
  end if;
  update departments set is_default = false where is_default and id <> p_id;
  update departments set is_default = true where id = p_id;
end $$;

-- ---------- Прайс ----------
create table public.price_lists (
  id           bigint generated always as identity primary key,
  title        text not null,
  valid_from   date not null,
  file_name    text,
  uploaded_by  bigint references public.employees (id),
  applied_at   timestamptz not null default now(),
  stats        jsonb
);

create table public.price_items (
  id           bigint generated always as identity primary key,
  source_id    integer unique,                  -- id строки из price_2026_max.csv
  full_name    text not null unique check (length(trim(full_name)) > 0),
  short_name   text not null check (length(trim(short_name)) > 0),
  category     text not null,
  subcategory  text,
  unit_id      smallint not null references public.units (id),
  is_material  boolean not null default false,  -- материалы мастеру не показываются
  is_active    boolean not null default true,
  origin       text not null default 'csv' check (origin in ('csv', 'manual')),
  source_block text,
  source_row   integer,
  search_text  text generated always as (public.normalize_search(full_name)) stored,
  created_at   timestamptz not null default now()
);
create index price_items_category_idx on public.price_items (category, subcategory) where is_active and not is_material;

-- История цен: новая цена действует с valid_from и не меняет уже внесённые работы.
create table public.price_item_prices (
  id             bigint generated always as identity primary key,
  price_item_id  bigint not null references public.price_items (id) on delete cascade,
  price_kop      bigint not null check (price_kop > 0),
  valid_from     date not null,
  price_list_id  bigint references public.price_lists (id),  -- null — правка вручную
  created_by     bigint references public.employees (id),
  created_at     timestamptz not null default now(),
  unique (price_item_id, valid_from)
);

-- Цена позиции на дату. Только для серверных функций (подстановка цены при отправке смены).
create or replace function public.price_on(p_item bigint, p_date date) returns bigint
language sql stable security definer set search_path = public as $$
  select price_kop from price_item_prices
  where price_item_id = p_item and valid_from <= p_date
  order by valid_from desc limit 1
$$;

-- ---------- Поиск работ (для выбора работы мастером; без цен) ----------
create or replace function public.search_price_items(
  q text default '', p_category text default null, p_subcategory text default null, p_limit integer default 50
)
returns table (id bigint, short_name text, category text, subcategory text, unit_id smallint, unit_code text, integer_only boolean)
language sql stable security invoker set search_path = public as $$
  select p.id, p.short_name, p.category, p.subcategory, u.id, u.code, u.integer_only
  from price_items p join units u on u.id = p.unit_id
  where p.is_active and not p.is_material
    and (p_category is null or p.category = p_category)
    and (p_subcategory is null or p.subcategory = p_subcategory)
    and public.search_words_match(p.search_text, q)
  order by
    -- сначала названия, которые начинаются с запроса, потом где слово встречается раньше
    (public.normalize_search(p.short_name) like public.normalize_search(trim(q)) || '%') desc,
    nullif(strpos(public.normalize_search(p.short_name), split_part(public.normalize_search(trim(q)), ' ', 1)), 0) nulls last,
    length(p.short_name), p.short_name
  limit least(greatest(p_limit, 1), 200)
$$;

create or replace function public.price_categories()
returns table (category text, subcategory text, items bigint)
language sql stable security invoker set search_path = public as $$
  select category, subcategory, count(*)
  from price_items
  where is_active and not is_material
  group by category, subcategory
  order by category, subcategory nulls first
$$;

-- ---------- Прайс для руководителя: с ценами, фильтрами и постраничным выводом ----------
create or replace function public.admin_price_items(
  q text default '', p_filter text default 'active', p_limit integer default 50, p_offset integer default 0,
  p_id bigint default null
)
returns table (
  id bigint, short_name text, full_name text, category text, subcategory text, unit_id smallint, unit_code text,
  is_active boolean, is_material boolean, origin text, price_kop bigint, price_valid_from date, total bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Доступно только руководителю' using errcode = '42501'; end if;
  return query
    select p.id, p.short_name, p.full_name, p.category, p.subcategory, u.id, u.code,
           p.is_active, p.is_material, p.origin, cur.price_kop, cur.valid_from,
           count(*) over ()
    from price_items p
    join units u on u.id = p.unit_id
    left join lateral (
      select pp.price_kop, pp.valid_from from price_item_prices pp
      where pp.price_item_id = p.id and pp.valid_from <= public.app_today()
      order by pp.valid_from desc limit 1
    ) cur on true
    where (p_id is null or p.id = p_id)
      and public.search_words_match(p.search_text, q)
      and case p_filter
            when 'active' then p.is_active and not p.is_material
            when 'inactive' then not p.is_active
            when 'material' then p.is_material
            else true
          end
    order by p.category, p.subcategory nulls first, p.short_name
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- Новая цена позиции с даты (по умолчанию — с сегодняшнего дня).
create or replace function public.admin_set_price(p_item bigint, p_price_kop bigint, p_valid_from date default null)
returns void
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_valid_from, public.app_today());
begin
  if not public.is_manager() then raise exception 'Доступно только руководителю' using errcode = '42501'; end if;
  if p_price_kop is null or p_price_kop <= 0 then raise exception 'Цена должна быть больше нуля'; end if;
  if not exists (select 1 from price_items where id = p_item) then raise exception 'Позиция прайса не найдена'; end if;
  insert into price_item_prices (price_item_id, price_kop, valid_from, created_by)
  values (p_item, p_price_kop, d, public.current_employee_id())
  on conflict (price_item_id, valid_from)
  do update set price_kop = excluded.price_kop, price_list_id = null,
                created_by = excluded.created_by, created_at = now();
end $$;

-- ---------- Права и RLS ----------
alter table public.units enable row level security;
alter table public.departments enable row level security;
alter table public.price_lists enable row level security;
alter table public.price_items enable row level security;
alter table public.price_item_prices enable row level security;

create policy units_select on public.units for select to authenticated using (true);

create policy departments_select on public.departments for select to authenticated using (true);
create policy departments_insert on public.departments for insert to authenticated with check (public.is_manager());
create policy departments_update on public.departments for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Мастер видит только то, что можно выбрать: активные работы, не материалы.
create policy price_items_select on public.price_items for select to authenticated
  using (public.is_manager() or (is_active and not is_material));
create policy price_items_update on public.price_items for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy price_lists_select on public.price_lists for select to authenticated using (public.is_manager());
create policy price_item_prices_select on public.price_item_prices for select to authenticated using (public.is_manager());

revoke all on public.units, public.departments, public.price_lists, public.price_items, public.price_item_prices from anon, authenticated;
grant select on public.units, public.departments, public.price_items to authenticated;
grant insert (name, sort) on public.departments to authenticated;
grant update (name, is_active, sort, is_default) on public.departments to authenticated;
grant update (short_name, category, subcategory, unit_id, is_material, is_active) on public.price_items to authenticated;
-- Цены и версии прайса — только чтение и только руководителю (RLS); запись — через admin_set_price.
grant select on public.price_lists, public.price_item_prices to authenticated;

revoke all on function public.price_on(bigint, date) from public, anon, authenticated;
revoke all on function public.set_default_department(smallint) from public, anon;
revoke all on function public.search_price_items(text, text, text, integer) from public, anon;
revoke all on function public.price_categories() from public, anon;
revoke all on function public.admin_price_items(text, text, integer, integer, bigint) from public, anon;
revoke all on function public.admin_set_price(bigint, bigint, date) from public, anon;
grant execute on function public.set_default_department(smallint) to authenticated;
grant execute on function public.search_price_items(text, text, text, integer) to authenticated;
grant execute on function public.price_categories() to authenticated;
grant execute on function public.admin_price_items(text, text, integer, integer, bigint) to authenticated;
grant execute on function public.admin_set_price(bigint, bigint, date) to authenticated;
