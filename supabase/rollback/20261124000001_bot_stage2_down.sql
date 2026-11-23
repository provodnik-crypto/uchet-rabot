-- Откат «Уведомления ботом Телемоста, часть 2» (24.11.2026).
drop trigger if exists bot_assign on public.requests;
drop function if exists public.bot_on_assign();
drop function if exists public.bot_yandex_login(bigint);
alter table public.employees drop column if exists yandex_login;
