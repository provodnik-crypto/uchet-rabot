-- Откат 20261013000002_close_old_requests.sql: убрать закрытие пачкой и фильтр.
-- Закрытые пачкой заявки остаются закрытыми; открыть по одной — «Открыть снова» в карточке.
begin;
drop function if exists public.close_old_requests(date);
drop function if exists public.old_open_requests(date);
drop function public.list_requests(text, integer, text);
create function public.list_requests(q text default '', p_limit integer default 100)
returns table (id bigint, number text, subject text, entries bigint, last_work_date date,
               plan_minutes integer, spent_minutes integer, state text, carries integer, since date,
               source text, service text, operation text, description text, itsm_status text,
               registered_at timestamp, requester text, is_open boolean, assignee_id bigint,
               assignee_name text, to_contractor boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select r.id, r.number, r.subject,
           (select count(*) from work_entries e where e.request_id = r.id),
           greatest((select max(s.work_date) from work_entries e join shifts s on s.id = e.shift_id where e.request_id = r.id),
                    (select max(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id)),
           r.plan_minutes,
           (select sum(x.minutes)::int from shift_requests x where x.request_id = r.id),
           r.state,
           (select count(*)::int from shift_requests x where x.request_id = r.id and x.status = 'unfinished'),
           (select min(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id),
           r.source, r.service, r.operation, r.description, r.itsm_status,
           r.registered_at, r.requester, r.is_open, r.assignee_id, a.display_name, r.to_contractor
    from requests r
    left join employees a on a.id = r.assignee_id
    where public.search_words_match(public.normalize_search(
            r.number || ' ' || coalesce(r.subject, '') || ' ' || coalesce(r.operation, '') || ' ' || coalesce(r.description, '')), q)
    order by r.is_open desc, greatest(
               (select max(s.work_date) from work_entries e join shifts s on s.id = e.shift_id where e.request_id = r.id)::timestamp,
               (select max(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id)::timestamp,
               r.registered_at, r.created_at::timestamp) desc nulls last
    limit least(greatest(p_limit, 1), 300);
end $$;

revoke all on function public.list_requests(text, integer) from public, anon;
grant execute on function public.list_requests(text, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
