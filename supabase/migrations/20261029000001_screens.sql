-- Аудит, этап 3: логика экранов. Только добавляет; откат — supabase/rollback/20261029000001_screens_down.sql
--  * awaiting_totals — работы «ждут приёмки» за период (в суммы не входят, показываются отдельной строкой);
--  * request_counts — точные счётчики открытых заявок по статусам для главной руководителя;
--  * list_requests: фильтр 'stale' — «в работе дольше порога»;
--  * request_row — строка заявки для карточки руководителя по id (без поиска по номеру);
--  * set_manual_request_title — название ручной заявки (то, что видит мастер);
--  * set_request_priority — не у принятых и закрытых;
--  * request_card.open_asks — мои открытые просьбы по заявке (закрыть / передать подрядчику).

create function public.awaiting_totals(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return (select jsonb_build_object('entries', count(*)::int, 'total_kop', coalesce(sum(m.total_kop), 0))
          from work_entries w join shifts s on s.id = w.shift_id left join entry_money m on m.entry_id = w.id
          where w.status = 'awaiting' and s.work_date between p_from and p_to);
end $$;

create function public.request_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return (select jsonb_build_object(
            'waiting', count(*) filter (where status = 'waiting'),
            'in_work', count(*) filter (where status = 'in_work'),
            'review', count(*) filter (where status = 'review'),
            'paused', count(*) filter (where status = 'paused'),
            'contractor', count(*) filter (where status = 'contractor'))
          from requests where is_open and status <> 'accepted');
end $$;

create function public.request_row(p_id bigint) returns TABLE(id bigint, number text, subject text, entries bigint, last_work_date date, plan_minutes integer, spent_minutes integer, state text, carries integer, since date, source text, service text, operation text, description text, itsm_status text, registered_at timestamp without time zone, requester text, is_open boolean, assignee_id bigint, assignee_name text, to_contractor boolean, status text, priority smallint, responsible_id bigint, responsible_name text, taken_at timestamp with time zone, last_activity_at timestamp with time zone, returned_comment text, unread integer, stale_days integer, due_at timestamp without time zone, hold_reason text, hold_number text, pause_request text, pause_requested_at timestamp with time zone, work_days integer)
language sql stable security definer set search_path = public as $$
  select x.* from public.requests rr cross join lateral public.list_requests(rr.number, 100000, 'all') x
  where rr.id = p_id and x.id = p_id
$$;

create function public.set_manual_request_title(p_id bigint, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare t text := trim(coalesce(p_title, ''));
begin
  perform public.require_manager();
  if length(t) < 3 or length(t) > 200 then raise exception 'Название — от 3 до 200 знаков'; end if;
  update requests set operation = t, subject = t where id = p_id and source = 'manual';
  if not found then raise exception 'Менять название можно только у ручной заявки'; end if;
end $$;

do $$
declare
  d text; n text; f text;
  pairs text[][] := array[
    array['public.list_requests(text,integer,text,text,smallint,bigint)',
          $r$or p_lifecycle = 'materials' and r.status = 'paused' and r.hold_reason = 'materials')$r$,
          $r$or p_lifecycle = 'materials' and r.status = 'paused' and r.hold_reason = 'materials'
               or p_lifecycle = 'stale' and r.status = 'in_work' and public.request_work_days(r.taken_at) > public.stale_work_days())$r$],
    array['public.set_request_priority(bigint,smallint)',
          $r$  select priority into v_old from requests where id = p_id;
  if not found then raise exception 'Заявка не найдена'; end if;$r$,
          $r$  select priority into v_old from requests where id = p_id;
  if not found then raise exception 'Заявка не найдена'; end if;
  if exists (select 1 from requests where id = p_id and (status = 'accepted' or not is_open)) then
    raise exception 'У принятой или закрытой заявки приоритет не меняется';
  end if;$r$],
    array['public.request_card(bigint,text)',
          $r$'taken_at', r.taken_at, 'is_planned', r.is_planned,$r$,
          $r$'taken_at', r.taken_at, 'is_planned', r.is_planned,
    'open_asks', coalesce((select jsonb_agg(m.kind) from master_reports m where m.about_request = r.id and m.status in ('new', 'read')
                           and m.author_id = public.current_employee_id()), '[]'::jsonb),$r$]
  ];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][2], f; end if;
    execute n;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.awaiting_totals(date, date)', 'public.request_counts()', 'public.request_row(bigint)',
                           'public.set_manual_request_title(bigint, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
