-- Мастер не видит денег по людям: ни своей суммы, ни сумм и выработки коллег (решение заказчика 30.10.2026).
-- Вместо этого — итог всей команды магазина за текущий месяц (team_result): сумма, заявки, работы — без строк по людям.
-- Закрытие сразу (не «через день»): старое приложение получает пустой рейтинг и сумму «—», но не падает.
-- Руководитель получает всё как раньше. Откат: supabase/rollback/20261030000001_team_result_down.sql

-- Итог команды магазина за текущий месяц: только принятые работы. Магазин — тот, к которому привязан сотрудник.
create function public.team_result() returns table (month date, total_kop bigint, requests bigint, entries bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_store smallint;
  v_from date := date_trunc('month', public.app_today())::date;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select coalesce(e.store_id, public.default_store_id()) into v_store from employees e where e.id = me;
  return query
    select v_from,
           coalesce(sum(m.total_kop), 0)::bigint,
           count(distinct w.request_id),
           count(w.id)
    from work_entries w
    join shifts s on s.id = w.shift_id
    join employees a on a.id = s.author_id
    left join entry_money m on m.entry_id = w.id
    where w.status = 'priced' and s.work_date >= v_from
      and coalesce(a.store_id, public.default_store_id()) = v_store;
end $$;
revoke all on function public.team_result() from public, anon;
grant execute on function public.team_result() to authenticated;

-- Рейтинг и суммы по месяцам — только руководителю; мастеру (и старой версии приложения) — пусто.
create or replace function public.team_rating(p_from date, p_to date)
returns table (employee_id bigint, display_name text, total_kop bigint, entries bigint, requests bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_employee_id() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if not public.is_manager() then return; end if;
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

create or replace function public.team_by_month(p_from date, p_to date)
returns table (month date, employee_id bigint, display_name text, total_kop bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_employee_id() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if not public.is_manager() then return; end if;
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

-- Свои счётчики за месяц остаются; сумма в рублях — только руководителю (мастеру null → старое приложение покажет «—»).
create or replace function public.my_month_summary()
returns table (total_kop bigint, requests bigint, entries bigint, pending bigint, awaiting bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_from date := date_trunc('month', public.app_today())::date;
  v_mgr boolean := public.is_manager();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select case when v_mgr then coalesce(sum(pm.share_kop) filter (where e.status = 'priced'), 0)::bigint end,
           count(distinct e.request_id) filter (where e.status = 'priced'),
           count(distinct e.id) filter (where e.status = 'priced'),
           count(distinct e.id) filter (where e.status = 'pending'),
           count(distinct e.id) filter (where e.status = 'awaiting')
    from entry_performers ep
    join work_entries e on e.id = ep.entry_id
    join shifts s on s.id = e.shift_id
    left join performer_money pm on pm.entry_id = e.id and pm.employee_id = me
    where ep.employee_id = me and s.work_date >= v_from and s.work_date <= public.app_today();
end $$;
