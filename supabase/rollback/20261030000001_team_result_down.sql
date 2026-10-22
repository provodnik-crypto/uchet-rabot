-- Откат 20261030000001_team_result: прежние версии функций (мастер снова видит свою сумму и рейтинг).
drop function if exists public.team_result();
CREATE OR REPLACE FUNCTION public.team_rating(p_from date, p_to date)
 RETURNS TABLE(employee_id bigint, display_name text, total_kop bigint, entries bigint, requests bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_employee_id() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select emp.id, emp.display_name,
           coalesce(sum(pm.share_kop), 0)::bigint,
           count(distinct e.id),
           count(distinct e.request_id)
    from employees emp
    left join performer_money pm on pm.employee_id = emp.id
      and exists (select 1 from work_entries e2 join shifts s2 on s2.id = e2.shift_id
                  where e2.id = pm.entry_id and e2.status = 'priced' and s2.work_date between p_from and p_to)
    left join work_entries e on e.id = pm.entry_id
    where emp.role = 'master' and emp.is_active and emp.in_output_chart
    group by emp.id
    order by 3 desc, emp.display_name;
end $function$

;
CREATE OR REPLACE FUNCTION public.team_by_month(p_from date, p_to date)
 RETURNS TABLE(month date, employee_id bigint, display_name text, total_kop bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_employee_id() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select date_trunc('month', s.work_date)::date, emp.id, emp.display_name, sum(pm.share_kop)::bigint
    from performer_money pm
    join work_entries e on e.id = pm.entry_id and e.status = 'priced'
    join shifts s on s.id = e.shift_id
    join employees emp on emp.id = pm.employee_id
    where s.work_date between p_from and p_to and emp.role = 'master' and emp.in_output_chart
    group by 1, emp.id
    order by 1 desc, 4 desc;
end $function$

;
CREATE OR REPLACE FUNCTION public.my_month_summary()
 RETURNS TABLE(total_kop bigint, requests bigint, entries bigint, pending bigint, awaiting bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  v_from date := date_trunc('month', public.app_today())::date;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select coalesce(sum(pm.share_kop) filter (where e.status = 'priced'), 0)::bigint,
           count(distinct e.request_id) filter (where e.status = 'priced'),
           count(distinct e.id) filter (where e.status = 'priced'),
           count(distinct e.id) filter (where e.status = 'pending'),
           count(distinct e.id) filter (where e.status = 'awaiting')
    from entry_performers ep
    join work_entries e on e.id = ep.entry_id
    join shifts s on s.id = e.shift_id
    left join performer_money pm on pm.entry_id = e.id and pm.employee_id = me
    where ep.employee_id = me and s.work_date >= v_from and s.work_date <= public.app_today();
end $function$

;
