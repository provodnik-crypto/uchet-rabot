-- Время выполнения заявок больше не учитываем (решение заказчика 22.10.2026).
-- * Старые данные остаются на месте как архив и нигде не показываются:
--   shift_requests.minutes (время мастеров за смену), requests.plan_minutes (примерное/плановое время).
--   Новое приложение время не отправляет; старые версии ещё могут — база принимает, но не показывает.
-- * На проверку заявку отправляют, только если по ней есть хотя бы одна работа (время больше не в счёт).
-- * «Давность» заявки: рабочие дни «В работе» от «Взять в работу» (work_days), порог подсветки —
--   настройка магазина stores.stale_work_days (по умолчанию 3), меняет руководитель.
-- Только добавляет и меняет правила: старое приложение продолжает работать.
-- Откат: supabase/rollback/20261022000001_no_time_down.sql
alter table public.stores add column stale_work_days smallint not null default 3 check (stale_work_days between 1 and 60);

/** Порог «долго в работе» для магазина сотрудника. */
create function public.stale_work_days() returns smallint
language sql stable security definer set search_path = public as $$
  select coalesce((select s.stale_work_days from stores s
                   where s.id = coalesce((select e.store_id from employees e where e.id = public.current_employee_id()), public.default_store_id())), 3)::smallint
$$;

create function public.set_stale_work_days(p_days smallint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manager();
  if p_days is null or p_days < 1 or p_days > 60 then raise exception 'Порог: от 1 до 60 рабочих дней'; end if;
  update stores set stale_work_days = p_days
  where id = coalesce((select e.store_id from employees e where e.id = public.current_employee_id()), public.default_store_id());
end $$;

/** Сколько рабочих дней заявка «В работе» (от «Взять в работу»; взята сегодня — 0). */
create function public.request_work_days(p_taken timestamptz) returns integer
language sql stable security definer set search_path = public as $$
  select case when p_taken is null then null
              else public.working_days_since((p_taken at time zone public.app_timezone())::date) end
$$;

do $$
declare f text;
begin
  foreach f in array array['public.stale_work_days()', 'public.set_stale_work_days(smallint)', 'public.request_work_days(timestamp with time zone)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- на проверку — только с работами
create or replace function public.send_request_for_review(p_id bigint, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $function$
declare me bigint := public.current_employee_id();
begin
  if not exists (select 1 from requests where id = p_id and status = 'in_work' and responsible_id = me) then
    raise exception 'Отправить может только мастер, который взял заявку';
  end if;
  if not exists (select 1 from work_entries where request_id = p_id and status <> 'rejected') then
    raise exception 'Добавьте хотя бы одну работу по заявке';
  end if;
  update requests set status = 'review', sent_at = now(), returned_comment = null, pause_request = null, pause_requested_at = null
  where id = p_id;
  perform public.log_request_event(p_id, 'send', 'in_work', 'review', p_comment);
  perform public.resume_next(me);
end $function$;

-- давность в списке руководителя и в «Сейчас в работе»; уведомление — по порогу от «Взять в работу»
do $$
declare
  d text; n text; f text;
  pairs text[][] := array[
    array['public.list_requests(text, integer, text, text, smallint, bigint)', 'pause_request text, pause_requested_at timestamp with time zone)',
          'pause_request text, pause_requested_at timestamp with time zone, work_days integer)'],
    array['public.list_requests(text, integer, text, text, smallint, bigint)', E'r.pause_request, r.pause_requested_at\n    from requests r',
          E'r.pause_request, r.pause_requested_at,\n           case when r.status = \'in_work\' then public.request_work_days(r.taken_at) end\n    from requests r'],
    array['public.masters_now()', 'paused integer, returned boolean)', 'paused integer, returned boolean, work_days integer)'],
    array['public.masters_now()', E'r.returned_comment is not null\n    from employees e',
          E'r.returned_comment is not null, public.request_work_days(r.taken_at)\n    from employees e'],
    array['public.my_notifications()', $r$'stale', (select count(*)::int from requests r where r.status = 'in_work' and r.is_open
                and public.working_days_since((coalesce(r.last_activity_at, r.taken_at) at time zone public.app_timezone())::date) > 3)$r$,
          $r$'stale', (select count(*)::int from requests r where r.status = 'in_work' and r.is_open
                and public.request_work_days(r.taken_at) > public.stale_work_days()),
      'stale_days', public.stale_work_days()$r$]
  ];
  i int;
  defs jsonb := '{}';
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := coalesce(defs ->> f, pg_get_functiondef(f::regprocedure));
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][2], f; end if;
    defs := defs || jsonb_build_object(f, n);
  end loop;
  for f in select jsonb_object_keys(defs) loop
    if f in ('public.list_requests(text, integer, text, text, smallint, bigint)', 'public.masters_now()') then
      execute 'drop function ' || f;
      execute defs ->> f;
      execute format('revoke all on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    else
      execute defs ->> f;
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
