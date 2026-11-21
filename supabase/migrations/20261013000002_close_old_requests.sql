-- Закрыть старые заявки ITSM пачкой и фильтр «Открытые / Закрытые / Все» в списке руководителя.
-- Закрытие обратимо: «Открыть снова» в карточке заявки. Работы и время по заявкам не меняются.
-- Откат: supabase/rollback/20261013000002_close_old_requests_down.sql

-- ---------- Список заявок руководителя: + фильтр по состоянию ----------
-- p_status: all | open | closed. Старые версии приложения вызывают без p_status — получают «все».
drop function public.list_requests(text, integer);
create function public.list_requests(q text default '', p_limit integer default 100, p_status text default 'all')
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
    where (p_status is distinct from 'open' or r.is_open)
      and (p_status is distinct from 'closed' or not r.is_open)
      and public.search_words_match(public.normalize_search(
            r.number || ' ' || coalesce(r.subject, '') || ' ' || coalesce(r.operation, '') || ' ' || coalesce(r.description, '')), q)
    order by r.is_open desc, greatest(
               (select max(s.work_date) from work_entries e join shifts s on s.id = e.shift_id where e.request_id = r.id)::timestamp,
               (select max(s.work_date) from shift_requests x join shifts s on s.id = x.shift_id where x.request_id = r.id)::timestamp,
               r.registered_at, r.created_at::timestamp) desc nulls last
    limit least(greatest(p_limit, 1), 300);
end $$;


-- ---------- Старые открытые заявки ITSM: предпросмотр и закрытие ----------
-- Старые — зарегистрированы раньше p_before (по умолчанию в приложении — старше 30 дней).
create function public.old_open_requests(p_before date)
returns table (id bigint, number text, operation text, description text, registered_at timestamp)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select r.id, r.number, r.operation, r.description, r.registered_at
    from requests r
    where r.source = 'itsm' and r.is_open and r.registered_at < p_before
    order by r.registered_at, r.id;
end $$;

create function public.close_old_requests(p_before date)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.require_manager();
  if p_before is null or p_before > public.store_today() then raise exception 'Неверная дата'; end if;
  update requests r set is_open = false, closed_at = now(), closed_by = public.current_employee_id()
  where r.source = 'itsm' and r.is_open and r.registered_at < p_before;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.list_requests(text, integer, text)',
    'public.old_open_requests(date)',
    'public.close_old_requests(date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
