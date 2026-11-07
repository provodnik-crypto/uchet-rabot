-- Этап 1: сотрудники, роли, вход.
-- Учётные записи живут в auth.users (Supabase Auth); сотрудник связан с ней по user_id.

-- Часовой пояс магазина (Тюмень, UTC+5): от него зависят «сегодня», «вчера», «конец дня».
create or replace function public.app_timezone() returns text
language sql immutable as $$ select 'Asia/Yekaterinburg' $$;

create or replace function public.app_today() returns date
language sql stable as $$ select (now() at time zone public.app_timezone())::date $$;

create type public.employee_role as enum ('master', 'manager', 'service');

create table public.employees (
  id               bigint generated always as identity primary key,
  display_name     text not null check (length(trim(display_name)) between 1 and 60),
  role             public.employee_role not null default 'master',
  user_id          uuid unique references auth.users (id) on delete set null,
  login            text unique check (login ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  is_active        boolean not null default true,
  -- «Не указан» и подобные служебные записи не попадают в диаграмму выработки.
  in_output_chart  boolean not null default true,
  has_account      boolean generated always as (user_id is not null) stored,
  created_at       timestamptz not null default now(),
  check (role <> 'service' or user_id is null)
);

create unique index employees_display_name_active_uq
  on public.employees (lower(display_name)) where is_active;

-- Текущий сотрудник по токену. security definer: функция нужна внутри политик RLS.
create or replace function public.current_employee_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.employees
  where user_id = auth.uid() and is_active and role in ('master', 'manager')
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees
    where user_id = auth.uid() and is_active and role = 'manager'
  )
$$;

-- Кто я: приложение по ответу выбирает экраны мастера или руководителя.
create or replace function public.whoami()
returns table (id bigint, display_name text, role public.employee_role, login text)
language sql stable security definer set search_path = public as $$
  select e.id, e.display_name, e.role, e.login
  from public.employees e
  where e.user_id = auth.uid() and e.is_active and e.role in ('master', 'manager')
$$;

alter table public.employees enable row level security;

-- Список сотрудников нужен всем: мастер выбирает напарников.
create policy employees_select on public.employees
  for select to authenticated using (true);

create policy employees_update_manager on public.employees
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- Анонимам — ничего. Через REST руководитель меняет только имя;
-- логины, роли и блокировку меняет серверная функция admin-users (сервисный ключ).
revoke all on public.employees from anon, authenticated;
grant select (id, display_name, role, login, is_active, in_output_chart, has_account) on public.employees to authenticated;
grant update (display_name) on public.employees to authenticated;

revoke all on function public.current_employee_id() from public, anon;
revoke all on function public.is_manager() from public, anon;
revoke all on function public.whoami() from public, anon;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.whoami() to authenticated;

-- Стартовый состав. Учётные записи создаёт руководитель в приложении.
insert into public.employees (display_name, role, in_output_chart) values
  ('Коля', 'master', true),
  ('Миша', 'master', true),
  ('Женя', 'master', true),
  ('Володя', 'master', true),
  ('Не указан', 'service', false);
