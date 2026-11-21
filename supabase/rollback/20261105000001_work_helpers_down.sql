-- Откат 20261105000001_work_helpers. Помощники, уже указанные по позициям, и разделённые строки остаются
-- (это обычные исполнители и работы — суммы по ним верны и без новых функций).
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.request_card(bigint,text)'::regprocedure);
  n := replace(d, $r$'main_id', s.author_id, $r$, '');
  if n <> d then execute n; end if;
end $$;
drop function if exists public.report_rows_v2(date, date);
drop function if exists public.split_my_work(bigint, numeric);
drop function if exists public.set_work_helpers(bigint, bigint[]);
