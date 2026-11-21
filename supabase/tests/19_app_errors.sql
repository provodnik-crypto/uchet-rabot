-- Журнал ошибок устройств: пишет вошедший пользователь через функцию, читать таблицу приложению нельзя.
begin;
select pg_temp.login_as('kolya');
select public.log_app_errors($j$[
  {"at": "2026-10-19T14:29:00Z", "screen": "/summary", "kind": "timeout", "message": "TimeoutError: Timeout",
   "app_version": "2026-10-18T04:43 abcd1234", "runtime_version": "3", "os": "android 34", "device": "x1"},
  "мусор"
]$j$::jsonb);
select pg_temp.assert(not has_table_privilege('authenticated', 'public.app_errors', 'select'), 'мастер не читает журнал');
reset role;
select pg_temp.assert((select count(*) from public.app_errors) = 1, 'записана одна строка, мусор пропущен');
select pg_temp.assert((select role || ' ' || screen || ' ' || kind from public.app_errors) = 'master /summary timeout', 'роль определена сервером');

select pg_temp.login_as('boss');
select public.log_app_errors('[{"screen": "/", "kind": "network", "message": "Network request failed", "at": "2099-01-01T00:00:00Z"}]'::jsonb);
reset role;
select pg_temp.assert((select role from public.app_errors where kind = 'network') = 'manager', 'руководитель записан как manager');
select pg_temp.assert((select happened_at <= now() from public.app_errors where kind = 'network'), 'время из будущего обрезано');

-- без входа ничего не пишется
set local role anon;
select pg_temp.assert(not has_function_privilege('anon', 'public.log_app_errors(jsonb)', 'execute'), 'без входа функция закрыта');
reset role;
rollback;
