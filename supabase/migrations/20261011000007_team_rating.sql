-- Рейтинг команды: по решению заказчика мастер видит итоговые суммы — свои и коллег — по месяцам.
-- Цены за единицу и суммы отдельных работ мастеру по-прежнему недоступны: только итоги.

-- Сумма каждого мастера за период (его доля в совместных работах), только оценённые работы.
create or replace function public.team_rating(p_from date, p_to date)
returns table (employee_id bigint, display_name text, total_kop bigint, entries bigint, requests bigint)
language plpgsql stable security definer set search_path = public as $$
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
end $$;

-- То же по месяцам.
create or replace function public.team_by_month(p_from date, p_to date)
returns table (month date, employee_id bigint, display_name text, total_kop bigint)
language plpgsql stable security definer set search_path = public as $$
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
end $$;

-- Главная мастера: моя сумма за текущий месяц, выполненные заявки и работы, сколько ждёт оценки.
create or replace function public.my_month_summary()
returns table (total_kop bigint, requests bigint, entries bigint, pending bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_from date := date_trunc('month', public.app_today())::date;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select coalesce(sum(pm.share_kop) filter (where e.status = 'priced'), 0)::bigint,
           count(distinct e.request_id) filter (where e.status = 'priced'),
           count(distinct e.id) filter (where e.status = 'priced'),
           count(distinct e.id) filter (where e.status = 'pending')
    from entry_performers ep
    join work_entries e on e.id = ep.entry_id
    join shifts s on s.id = e.shift_id
    left join performer_money pm on pm.entry_id = e.id and pm.employee_id = me
    where ep.employee_id = me and s.work_date >= v_from and s.work_date <= public.app_today();
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.team_rating(date, date)', 'public.team_by_month(date, date)', 'public.my_month_summary()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
