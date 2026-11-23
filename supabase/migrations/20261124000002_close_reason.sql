-- Причина закрытия (23.11.2026, заявка № 110). МВСО при ручном закрытии заявки, которая не «Принята»
-- (accepted), обязан указать причину: set_request_open получает p_comment, причина пишется в ленту
-- (kind 'close') и видна инициатору в карточке. Инициатору закрытая заявка отдаётся со статусом
-- 'closed' («Закрыта»), а не «Ожидает»; карточка отдаёт причину (close_comment) и признак is_mine.
-- Массовые закрытия (загрузка ITSM «Закрыть все свободные»/«пропавшие», «Закрыть старые») не тронуты.
-- Закрытие «Принятой» — без причины (там оценка инициатора).
-- Только добавляет: старая функция set_request_open(bigint, boolean) остаётся рядом для старых сборок,
-- убрать отдельной миграцией, когда обновление разошлось. Откат: supabase/rollback/20261124000002_close_reason_down.sql

-- ---------- Закрытие с причиной (новая версия, вызывается приложением) ----------
create function public.set_request_open(p_id bigint, p_open boolean, p_comment text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  perform public.require_manager();
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if not p_open then
    if r.is_open then
      if r.status <> 'accepted' and coalesce(trim(p_comment), '') = '' then
        raise exception 'Укажите причину закрытия';
      end if;
      perform public.close_request_core(p_id);
      if r.status <> 'accepted' then
        perform public.log_request_event(p_id, 'close', r.status, r.status, trim(p_comment));
      end if;
    end if;
    return;
  end if;
  if not r.is_open and r.status = 'in_work' then
    perform 1 from employees where id = r.responsible_id for update;
    if (public.active_request_of(r.responsible_id, p_id)).id is not null then
      update requests set status = 'paused', hold_reason = 'pause', paused_at = now(), pause_request = null, pause_requested_at = null
      where id = p_id;
    end if;
  end if;
  update requests set is_open = true, closed_at = null, closed_by = null where id = p_id;
end $$;
revoke all on function public.set_request_open(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.set_request_open(bigint, boolean, text) to authenticated;

-- ---------- Инициатору закрытая заявка — «Закрыта», а не «Ожидает» ----------
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
    -- отработанные: выполненные и закрытые; свежие сверху; закрытая показывается как 'closed'
    select coalesce(store_id, public.default_store_id()) into v_store from employees e where e.id = me;
    return query
      select r.id, r.number, r.subject, r.operation,
             case when r.is_open then r.status else 'closed' end, r.priority,
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
      select r.id, r.number, r.subject, r.operation,
             case when r.is_open then r.status else 'closed' end, r.priority,
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

-- ---------- Карточка: статус 'closed', причина закрытия, своя ли заявка ----------
create or replace function public.initiator_request_card(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'id', r.id, 'number', r.number, 'subject', r.subject, 'operation', r.operation,
      'status', case when r.is_open then r.status else 'closed' end,
      'priority', r.priority, 'place', r.place, 'materials', r.materials,
      'urgent_reason', r.urgent_reason, 'due_at', r.due_at, 'registered_at', r.registered_at,
      'creator_name', cr.display_name, 'master_name', m.display_name, 'department_name', d.name,
      'is_mine', r.created_by = me,
      'close_comment', (select e.comment from request_events e
                        where e.request_id = r.id and e.kind = 'close' order by e.id desc limit 1),
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
