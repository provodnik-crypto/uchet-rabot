-- Откат 20261022000001_no_time.sql: снова можно отправить заявку «только со временем», давность — от последнего действия.
-- Экраны времени вернёт только откат приложения (обновление с коммита до доработки).
begin;
create or replace function public.send_request_for_review(p_id bigint, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $function$
declare me bigint := public.current_employee_id();
begin
  if not exists (select 1 from requests where id = p_id and status = 'in_work' and responsible_id = me) then
    raise exception 'Отправить может только мастер, который взял заявку';
  end if;
  if not exists (select 1 from work_entries where request_id = p_id and status <> 'rejected')
     and not exists (select 1 from shift_requests where request_id = p_id and minutes > 0) then
    raise exception 'По заявке нет ни работ, ни времени';
  end if;
  update requests set status = 'review', sent_at = now(), returned_comment = null, pause_request = null, pause_requested_at = null
  where id = p_id;
  perform public.log_request_event(p_id, 'send', 'in_work', 'review', p_comment);
  perform public.resume_next(me);
end $function$;

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
    n := replace(d, pairs[i][3], pairs[i][2]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][3], f; end if;
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

drop function public.request_work_days(timestamp with time zone);
drop function public.set_stale_work_days(smallint);
drop function public.stale_work_days();
alter table public.stores drop column stale_work_days;
commit;
notify pgrst, 'reload schema';
