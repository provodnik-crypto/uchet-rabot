-- Этап «История» (22.11.2026): у инициатора «Мои» и «Отдел» показывают только актуальные заявки,
-- отработанные (выполненные и закрытые) уходят во вкладку «История» (p_history = true).
-- В истории scope 'my'/'department'/'all' — свои / отдела / все закрытые магазина; свежие сверху.
-- Откат: supabase/rollback/20261122000003_history_down.sql.

drop function public.initiator_requests(text);

create function public.initiator_requests(p_scope text, p_history boolean default false)
returns table (
  id bigint, number text, subject text, operation text, status text, priority smallint,
  place text, due_date date, materials text, urgent_reason text, created_at timestamp without time zone,
  creator_name text, master_name text, department_name text, can_cancel boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  me bigint := public.current_initiator_id();
  v_store smallint;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if p_history then
    -- отработанные: выполненные и закрытые; свежие сверху
    select coalesce(store_id, public.default_store_id()) into v_store from employees e where e.id = me;
    return query
      select r.id, r.number, r.subject, r.operation, r.status, r.priority,
             r.place, r.due_at::date, r.materials, r.urgent_reason,
             r.registered_at, cr.display_name, m.display_name, d.name,
             false
      from requests r
      left join employees cr on cr.id = r.created_by
      left join employees m on m.id = r.assignee_id
      left join departments d on d.id = r.department_id
      where ((not r.is_open) or r.status = 'accepted')
        and case when p_scope = 'my' then r.created_by = me
                 when p_scope = 'department' then r.department_id is not null
                      and r.department_id = (select e.department_id from employees e where e.id = me)
                 else r.store_id = v_store end
      order by r.registered_at desc, r.id desc;
  else
    -- актуальные: только незакрытые и не выполненные
    return query
      select r.id, r.number, r.subject, r.operation, r.status, r.priority,
             r.place, r.due_at::date, r.materials, r.urgent_reason,
             r.registered_at, cr.display_name, m.display_name, d.name,
             r.is_open and r.status = 'waiting'
      from requests r
      left join employees cr on cr.id = r.created_by
      left join employees m on m.id = r.assignee_id
      left join departments d on d.id = r.department_id
      where r.is_open and r.status <> 'accepted'
        and case when p_scope = 'department'
                 then r.department_id is not null
                      and r.department_id = (select e.department_id from employees e where e.id = me)
                 else r.created_by = me end
      order by r.registered_at asc, r.id asc;
  end if;
end $$;
revoke all on function public.initiator_requests(text, boolean) from public, anon;
grant execute on function public.initiator_requests(text, boolean) to authenticated;
