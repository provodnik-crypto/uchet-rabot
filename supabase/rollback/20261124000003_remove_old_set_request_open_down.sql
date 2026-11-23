-- Откат 20261124000003_remove_old_set_request_open.sql:
-- возвращает перегрузку set_request_open(bigint, boolean) без причины (версия из 20261028000001)
-- и decide_master_report с прежним вызовом без причины (тело с прода после 20261028000001).

create or replace function public.set_request_open(p_id bigint, p_open boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  perform public.require_manager();
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if not p_open then
    if r.is_open then perform public.close_request_core(p_id); end if;
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

create or replace function public.decide_master_report(p_id bigint, p_action text, p_comment text default null, p_title text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m master_reports; v_req jsonb;
begin
  perform public.require_manager();
  select * into m from master_reports where id = p_id for update;
  if m.id is null then raise exception 'Сообщение не найдено'; end if;
  if p_action = 'read' then
    if m.status = 'new' then
      update master_reports set status = 'read', decided_at = now(), decided_by = public.current_employee_id() where id = p_id;
    end if;
    return null;
  elsif p_action = 'reject' then
    if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите мастеру причину'; end if;
    update master_reports set status = 'rejected', answer = trim(p_comment), decided_at = now(),
           decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    if m.about_request is not null then
      perform public.log_request_event(m.about_request, 'comment', null, null,
        case m.kind when 'close' then 'Заявку не закрываем: ' else 'Подрядчику не передаём: ' end || left(trim(p_comment), 900));
    end if;
    return null;
  elsif p_action = 'request' then
    if m.status = 'request' then raise exception 'Заявка по сообщению уже создана'; end if;
    v_req := public.create_manual_request(coalesce(nullif(trim(p_title), ''), left(m.text, 200)), m.text, null);
    update master_reports set status = 'request', request_id = (v_req ->> 'id')::bigint, answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return v_req;
  elsif p_action = 'contractor' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;
    if m.status not in ('new', 'read') then raise exception 'Просьба уже решена или устарела'; end if;
    if m.status = 'contractor' then raise exception 'Заявка уже передана подрядчику'; end if;
    perform public.assign_request(m.about_request, null, true);
    update master_reports set status = 'contractor', answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return null;
  elsif p_action = 'close' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;
    if m.status not in ('new', 'read') then raise exception 'Просьба уже решена или устарела'; end if;
    if m.status = 'closed' then raise exception 'Заявка уже закрыта'; end if;
    perform public.set_request_open(m.about_request, false);
    perform public.log_request_event(m.about_request, 'comment', null, null,
      'Заявка закрыта по просьбе мастера' || coalesce(': ' || nullif(left(trim(coalesce(p_comment, '')), 900), ''), ''));
    update master_reports set status = 'closed', answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return null;
  end if;
  raise exception 'Неизвестное действие';
end $$;
