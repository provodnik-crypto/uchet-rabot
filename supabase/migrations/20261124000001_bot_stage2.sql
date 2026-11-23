-- Этап «Уведомления ботом Телемоста, часть 2» (24.11.2026). Личное сообщение мастеру,
-- когда заявку назначили ему (responsible_id). Старому ответственному ничего не шлётся.
-- Яндекс-логин сотрудника хранится в новой колонке employees.yandex_login (если не задана,
-- используется login, когда он цифровой — как у руководителей).
-- Телефон в сообщении: contact_phone заявки, иначе рабочий телефон создателя (031xxx).
-- Откат: supabase/rollback/20261124000001_bot_stage2_down.sql.

-- ---------- Колонка для логина в мессенджере ----------
alter table public.employees add column yandex_login text;
comment on column public.employees.yandex_login is
  'Логин сотрудника в Яндекс Мессенджере (для бота); пусто — использовать login, если он цифровой';

-- ---------- Логины мастеров (из справки отдела) ----------
-- Николай Х., Михаил М., Евгений Г., Владимир К.
update public.employees set yandex_login = '60315448' where id = 1;
update public.employees set yandex_login = '60288667' where id = 2;
update public.employees set yandex_login = '60264631' where id = 3;
update public.employees set yandex_login = '60286618' where id = 4;

-- ---------- Адрес бота для сотрудника ----------
create function public.bot_yandex_login(p_employee bigint)
returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_employee is null then return null; end if;
  select coalesce(nullif(yandex_login, ''),
                  case when login ~ '^[0-9]{3,20}$' then login end)
    into v
  from employees
  where id = p_employee and is_active;
  return v;
end $$;
revoke all on function public.bot_yandex_login(bigint) from public, anon, authenticated;

-- ---------- Назначение ответственного -> мастеру ----------
create function public.bot_on_assign()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_login text;
  v_phone text;
  v_msg text;
begin
  if new.responsible_id is null then return new; end if;
  select public.bot_yandex_login(new.responsible_id) into v_login;
  if coalesce(v_login, '') = '' then return new; end if;
  select coalesce(nullif(trim(new.contact_phone), ''), e.work_phone)
    into v_phone
  from employees e where e.id = new.created_by;
  v_msg := 'LM сервис: заявка № ' || coalesce(new.number, new.id::text) || ' назначена вам' || E'\n'
    || coalesce(nullif(trim(new.subject), ''), coalesce(new.operation, '')) ||
    (case when coalesce(new.place, '') <> '' then E'\nМесто: ' || new.place else '' end) ||
    (case when coalesce(v_phone, '') <> '' then E'\nТелефон: ' || v_phone else '' end) ||
    (case when new.priority = 1 then E'\nСрочно' else '' end);
  perform public.bot_send(v_login, v_msg, new.priority = 1);
  return new;
end $$;
revoke all on function public.bot_on_assign() from public, anon, authenticated;

create trigger bot_assign
after update of responsible_id on public.requests
for each row when (old.responsible_id is distinct from new.responsible_id)
execute function public.bot_on_assign();
