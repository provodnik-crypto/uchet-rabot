-- Этап «NPS-сводка» (22.11.2026): сводка оценок инициаторов за текущий и прошлый месяц — только для МВСО.
-- Данные — из request_ratings (этап «Оценки»); оценки остаются недоступны мастерам и инициаторам.
-- Откат: supabase/rollback/20261122000002_rating_summary_down.sql.

create function public.manager_rating_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := public.app_timezone();
  v_month_start timestamptz := date_trunc('month', now() at time zone tz);
  v_prev_start timestamptz := date_trunc('month', now() at time zone tz) - interval '1 month';
  v jsonb;
begin
  if not public.is_manager() then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select jsonb_build_object(
    'count', coalesce(cur.cnt, 0),
    'avg', case when coalesce(cur.cnt, 0) > 0 then round(cur.avg_score::numeric, 1) end,
    'fives', coalesce(cur.fives, 0), 'fours', coalesce(cur.fours, 0), 'threes', coalesce(cur.threes, 0),
    'twos', coalesce(cur.twos, 0), 'ones', coalesce(cur.ones, 0),
    'prev_count', coalesce(prev.cnt, 0),
    'prev_avg', case when coalesce(prev.cnt, 0) > 0 then round(prev.avg_score::numeric, 1) end)
  into v
  from
    (select count(*) cnt, avg(score) avg_score,
            count(*) filter (where score = 5) fives, count(*) filter (where score = 4) fours,
            count(*) filter (where score = 3) threes, count(*) filter (where score = 2) twos,
            count(*) filter (where score = 1) ones
     from request_ratings
     where created_at >= v_month_start and created_at < v_month_start + interval '1 month') cur,
    (select count(*) cnt, avg(score) avg_score
     from request_ratings
     where created_at >= v_prev_start and created_at < v_prev_start + interval '1 month') prev;
  return v;
end $$;
revoke all on function public.manager_rating_summary() from public, anon;
grant execute on function public.manager_rating_summary() to authenticated;
