-- Откат «Причина закрытия» (20261124000002_close_reason.sql).
-- Убираем новую версию set_request_open и возвращаем функции инициаторов как до правки.

drop function if exists public.set_request_open(bigint, boolean, text);

-- initiator_requests: версия из 20261122000003_history.sql (без 'closed')
create or replace function public.initiator_requests(p_scope text, p_history boolean default false)
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

-- initiator_request_card: версия из 20261121000002_initiators.sql (без is_mine/close_comment/'closed')
create or replace function public.initiator_request_card(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'id', r.id, 'number', r.number, 'subject', r.subject, 'operation', r.operation,
      'status', r.status, 'priority', r.priority, 'place', r.place, 'materials', r.materials,
      'urgent_reason', r.urgent_reason, 'due_at', r.due_at, 'registered_at', r.registered_at,
      'creator_name', cr.display_name, 'master_name', m.display_name, 'department_name', d.name,
      'can_cancel', r.is_open and r.status = 'waiting' and r.created_by = me,
      'photos', coalesce((select jsonb_agg(jsonb_build_object('path', x.path, 'thumb_path', x.thumb_path) order by x.position)
                          from extra_photos x where x.owner_kind = 'request' and x.owner_id = r.id), '[]'::jsonb))
    from requests r
    left join employees cr on cr.id = r.created_by
    left join employees m on m.id = r.assignee_id
    left join departments d on d.id = r.department_id
    where r.id = p_id
      and (r.created_by = me
           or exists (select 1 from employees e where e.id = me and e.department_id is not null
                      and r.department_id = e.department_id)));
end $$;
revoke all on function public.initiator_request_card(bigint) from public, anon;
grant execute on function public.initiator_request_card(bigint) to authenticated;
