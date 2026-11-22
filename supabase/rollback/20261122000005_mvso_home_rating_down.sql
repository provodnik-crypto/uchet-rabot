-- Откат этапа «Главная МВСО + рейтинги» (22.11.2026). Функции в исходном виде (по прод-определениям до этапа).

drop function if exists public.manager_dashboard();
create function public.manager_dashboard()
returns table (pending_count bigint, month_total_kop bigint, month_entries bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', public.app_today())::date;
begin
  perform public.require_manager();
  return query
    select (select count(*) from work_entries where status = 'pending'),
           coalesce((select sum(m.total_kop) from entry_money m join work_entries e on e.id = m.entry_id
                     join shifts s on s.id = e.shift_id where e.status = 'priced' and s.work_date >= v_from), 0)::bigint,
           (select count(*) from work_entries e join shifts s on s.id = e.shift_id
             where e.status = 'priced' and s.work_date >= v_from);
end $$;
revoke all on function public.manager_dashboard() from public, anon;
grant execute on function public.manager_dashboard() to authenticated;

drop function if exists public.report_by_employee(date, date);
create function public.report_by_employee(p_from date, p_to date)
returns table (employee_id bigint, display_name text, in_output_chart boolean, total_kop bigint, entries bigint, shifts bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select emp.id, emp.display_name, emp.in_output_chart, sum(pm.share_kop)::bigint, count(distinct e.id), count(distinct e.shift_id)
    from performer_money pm
    join work_entries e on e.id = pm.entry_id and e.status = 'priced'
    join shifts s on s.id = e.shift_id
    join employees emp on emp.id = pm.employee_id
    where s.work_date between p_from and p_to
    group by emp.id
    order by 4 desc;
end $$;
revoke all on function public.report_by_employee(date, date) from public, anon;
grant execute on function public.report_by_employee(date, date) to authenticated;
