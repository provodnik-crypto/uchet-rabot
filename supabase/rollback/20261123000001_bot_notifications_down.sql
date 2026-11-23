-- Откат «Уведомления ботом Телемоста, часть 1» (23.11.2026).
-- Убирает триггеры, функции и журнал bot_log. Токен в vault тоже удаляется.

drop trigger if exists bot_import on public.request_imports;
drop function if exists public.bot_on_import();

drop trigger if exists bot_initiator_request on public.requests;
drop function if exists public.bot_on_initiator_request();

drop function if exists public.bot_notify_managers(text, boolean);

drop trigger if exists bot_http_response on net._http_response;
drop function if exists public.bot_log_response();

drop function if exists public.bot_send(text, text, boolean);

do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'messenger_bot_token';
  if v_id is not null then
    perform vault.delete_secret(v_id);
  end if;
end $$;

drop table if exists public.bot_log;
