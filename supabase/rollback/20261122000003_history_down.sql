-- Откат этапа «История» (22.11.2026): возврат initiator_requests(text) — без фильтра актуальных,
-- как до этапа. Данные не трогаются. Точка восстановления: backups/db_backup_2026-11-22_initiators.json.gz.

drop function if exists public.initiator_requests(text, boolean);

create function public.initiator_requests(p_scope text)
returns table(id bigint, number text, subject text, operation text, status text, priority smallint,
  place text, due_date date, materials text, urgent_reason text, created_at timestamp without time zone,
  creator_name text, master_name text, department_name text, can_cancel boolean)
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select r.id, r.number, r.subject, r.operation, r.status, r.priority,
           r.place, r.due_at::date, r.materials, r.urgent_reason,
           r.registered_at, cr.display_name, m.display_name, d.name,
           r.is_open and r.status = 'waiting'
    from requests r
    left join employees cr on cr.id = r.created_by
    left join employees m on m.id = r.assignee_id
    left join departments d on d.id = r.department_id
    where case when p_scope = 'department'
               then r.department_id is not null
                    and r.department_id = (select e.department_id from employees e where e.id = me)
               else r.created_by = me end
    order by r.registered_at asc, r.id asc;
end $$;
revoke all on function public.initiator_requests(text) from public, anon;
grant execute on function public.initiator_requests(text) to authenticated;
