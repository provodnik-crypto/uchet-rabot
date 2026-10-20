-- Журнал ошибок на устройствах: экран, время, вид и текст ошибки, версия приложения, роль.
-- Без личных данных: ни имени, ни логина, ни id сотрудника; device — случайный номер установки.
-- Пишет только функция log_app_errors (вошедший пользователь); читать — через Management API.
-- Записи старше 90 дней удаляются при каждой записи.
-- Только добавляет новое: работающее приложение не задевает.
-- Откат: supabase/rollback/20261020000001_app_errors_down.sql
create table public.app_errors (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  happened_at timestamptz not null,
  screen text,
  kind text,
  message text,
  code text,
  app_version text,
  runtime_version text,
  os text,
  role text,
  device text
);
create index app_errors_created_at_idx on public.app_errors (created_at);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
revoke all on sequence public.app_errors_id_seq from anon, authenticated;

create function public.log_app_errors(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or jsonb_typeof(p_items) <> 'array' then return; end if;
  insert into app_errors (happened_at, screen, kind, message, code, app_version, runtime_version, os, role, device)
  select
    least(now(), greatest(now() - interval '30 days', coalesce((x ->> 'at')::timestamptz, now()))),
    left(x ->> 'screen', 120), left(x ->> 'kind', 20), left(x ->> 'message', 300), left(x ->> 'code', 20),
    left(x ->> 'app_version', 60), left(x ->> 'runtime_version', 20), left(x ->> 'os', 40),
    case when public.is_manager() then 'manager' else 'master' end,
    left(x ->> 'device', 20)
  from (select x from jsonb_array_elements(p_items) x limit 50) s
  where jsonb_typeof(x) = 'object';
  delete from app_errors where created_at < now() - interval '90 days';
end $$;
revoke execute on function public.log_app_errors(jsonb) from public, anon;
grant execute on function public.log_app_errors(jsonb) to authenticated;
