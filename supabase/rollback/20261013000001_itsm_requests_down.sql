-- Откат 20261013000001_itsm_requests.sql: заявки из ITSM, магазины, календарь, журнал загрузок.
-- Заявки, загруженные из ITSM, удаляются, если по ним нет работ и отметок времени; остальные
-- остаются с номером и темой. Приложение вернуть к коммиту до этапа (см. docs/RUN.md).
begin;
drop function if exists public.open_requests(text, text, integer);
drop function if exists public.assign_request(bigint, bigint, boolean);
drop function if exists public.set_request_open(bigint, boolean);
drop function if exists public.request_import_apply(jsonb);
drop function if exists public.request_import_context(text[]);
drop function if exists public.import_window(date, date);
drop function if exists public.requester_short(text);

delete from public.requests r
where r.source = 'itsm'
  and not exists (select 1 from public.work_entries e where e.request_id = r.id)
  and not exists (select 1 from public.shift_requests x where x.request_id = r.id);

-- Список заявок руководителя — как в 20261012000001_request_time.sql
drop function public.list_requests(text, integer);
create function public.list_requests(q text default '', p_limit integer default 100)
returns table (id bigint, number text, subject text, entries bigint, last_work_date date,
               plan_minutes integer, spent_minutes integer, state text, carries integer, since date)
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
           (select min(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id)
    from requests r
    where public.search_words_match(public.normalize_search(r.number || ' ' || coalesce(r.subject, '')), q)
    order by 5 desc nulls last, r.created_at desc
    limit least(greatest(p_limit, 1), 300);
end $$;

revoke all on function public.list_requests(text, integer) from public, anon;
grant execute on function public.list_requests(text, integer) to authenticated;

alter table public.requests
  drop constraint if exists requests_assign_one,
  drop constraint if exists requests_description_clean,
  drop column source, drop column store_id, drop column service, drop column operation,
  drop column description, drop column itsm_status, drop column registered_at, drop column requester,
  drop column is_open, drop column closed_at, drop column closed_by, drop column assignee_id,
  drop column to_contractor, drop column import_id;
grant select on public.requests to authenticated;

drop table public.request_imports;
drop function public.prev_workday(date);
drop function public.is_workday(date);
drop function public.store_today();
drop table public.work_calendar;
alter table public.employees drop column store_id;
drop function public.default_store_id();
drop table public.stores;
notify pgrst, 'reload schema';
commit;
