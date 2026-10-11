-- Этап 5: данные для Excel-отчёта. Только оценённые работы, только руководителю.

-- Выработка по месяцам в разрезе сотрудников (для диаграммы с накоплением).
create or replace function public.report_month_employee(p_from date, p_to date)
returns table (month date, employee_id bigint, display_name text, in_output_chart boolean, total_kop bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select date_trunc('month', s.work_date)::date, emp.id, emp.display_name, emp.in_output_chart, sum(pm.share_kop)::bigint
    from performer_money pm
    join work_entries e on e.id = pm.entry_id and e.status = 'priced'
    join shifts s on s.id = e.shift_id
    join employees emp on emp.id = pm.employee_id
    where s.work_date between p_from and p_to
    group by 1, emp.id
    order by 1, emp.display_name;
end $$;

-- Строки листа «Основной подсчет»: по строке на каждого исполнителя с его долей.
create or replace function public.report_rows(p_from date, p_to date)
returns table (
  work_date date, department_name text, request_number text, name text, unit_code text, quantity numeric,
  unit_price_kop bigint, entry_total_kop bigint, share_kop bigint, performer_count integer, performer_name text,
  note text, entry_id bigint, performer_position smallint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select s.work_date, d.name, r.number, coalesce(p.short_name, e.custom_name), u.code, e.quantity,
           m.unit_price_kop, m.total_kop, pm.share_kop,
           (select count(*)::int from entry_performers x where x.entry_id = e.id),
           emp.display_name, e.note, e.id, ep.position
    from work_entries e
    join shifts s on s.id = e.shift_id
    join entry_money m on m.entry_id = e.id
    join entry_performers ep on ep.entry_id = e.id
    join performer_money pm on pm.entry_id = e.id and pm.employee_id = ep.employee_id
    join employees emp on emp.id = ep.employee_id
    join departments d on d.id = e.department_id
    join units u on u.id = e.unit_id
    left join price_items p on p.id = e.price_item_id
    left join requests r on r.id = e.request_id
    where e.status = 'priced' and s.work_date between p_from and p_to
    order by s.work_date, s.id, e.position, ep.position;
end $$;

-- Объёмы и суммы по видам работ (категория «Вне прайса» — для работ, которых нет в прайсе).
create or replace function public.report_by_work(p_from date, p_to date)
returns table (category text, name text, unit_code text, quantity numeric, entries bigint, total_kop bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select coalesce(p.category, 'Вне прайса'), coalesce(p.short_name, e.custom_name), u.code,
           sum(e.quantity), count(*), sum(m.total_kop)::bigint
    from work_entries e
    join shifts s on s.id = e.shift_id
    join entry_money m on m.entry_id = e.id
    join units u on u.id = e.unit_id
    left join price_items p on p.id = e.price_item_id
    where e.status = 'priced' and s.work_date between p_from and p_to
    group by 1, 2, 3
    order by 1, 6 desc;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.report_month_employee(date, date)',
    'public.report_rows(date, date)',
    'public.report_by_work(date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
