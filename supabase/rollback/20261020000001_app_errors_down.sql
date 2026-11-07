-- Откат 20261020000001_app_errors.sql: убрать журнал ошибок устройств.
-- Приложение без этой функции работает: журнал просто перестанет отправляться (ошибка отправки не показывается).
begin;
drop function if exists public.log_app_errors(jsonb);
drop table if exists public.app_errors;
commit;
