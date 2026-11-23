-- Откат «Безопасность» (20261124000003_safety.sql).
-- Убираем новую версию create_initiator_request (остаётся старая, 9 аргументов),
-- снимаем метку safety с функций МВСО и удаляем столбец requests.safety.

drop function if exists public.create_initiator_request(text, text, smallint, text, date, boolean, text, text, jsonb, boolean);

do $$
declare d text; n text;
begin
  -- list_requests: убрать safety из выдачи и select
  d := pg_get_functiondef('public.list_requests(text, integer, text, text, smallint, bigint)'::regprocedure);
  n := replace(replace(d, ', safety boolean)', ')'), E', r.safety\n    from requests r', E'\n    from requests r');
  if n = d then raise exception 'list_requests: safety не найдена'; end if;
  execute 'drop function public.list_requests(text, integer, text, text, smallint, bigint)';
  execute n;
  execute format('revoke all on function %s from public, anon', 'public.list_requests(text, integer, text, text, smallint, bigint)');
  execute format('grant execute on function %s to authenticated', 'public.list_requests(text, integer, text, text, smallint, bigint)');

  -- request_card: убрать ключ safety
  d := pg_get_functiondef('public.request_card(bigint, text)'::regprocedure);
  n := replace(d, $r$'priority', r.priority, 'safety', r.safety,$r$, $r$'priority', r.priority,$r$);
  if n = d then raise exception 'request_card: safety не найдена'; end if;
  execute n;

  -- request_extra_fields: убрать ключ safety
  d := pg_get_functiondef('public.request_extra_fields(bigint)'::regprocedure);
  n := replace(d, $r$'urgent_reason', r.urgent_reason, 'safety', r.safety,$r$, $r$'urgent_reason', r.urgent_reason,$r$);
  if n = d then raise exception 'request_extra_fields: safety не найдена'; end if;
  execute n;
end $$;

alter table public.requests drop column if exists safety;
notify pgrst, 'reload schema';
