-- Откат 20261024000001_contractor_ask: прежние версии функций, без просьбы «Передать подрядчику».
drop function if exists public.request_contractor(bigint, text);
create or replace function public.my_master_reports() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'text', m.text, 'status', m.status, 'answer', m.answer, 'created_at', m.created_at,
           'decided_at', m.decided_at, 'request_id', m.request_id,
           'request_number', (select r.number from requests r where r.id = m.request_id),
           'unseen', m.decided_at is not null and m.seen_at is null and m.status <> 'read',
           'photos', public.report_photos(m.id)) order by m.created_at desc), '[]'::jsonb)
  from (select * from master_reports where author_id = public.current_employee_id() order by created_at desc limit 30) m
$$;

create or replace function public.list_master_reports(p_open boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return coalesce((select jsonb_agg(jsonb_build_object(
           'id', m.id, 'text', m.text, 'status', m.status, 'answer', m.answer, 'created_at', m.created_at,
           'author', e.display_name, 'request_id', m.request_id,
           'request_number', (select r.number from requests r where r.id = m.request_id),
           'photos', public.report_photos(m.id)) order by (m.status in ('new', 'read')) desc, m.created_at desc)
    from (select * from master_reports
          where not p_open or status in ('new', 'read') or created_at > now() - interval '30 days'
          order by created_at desc limit 100) m
    join employees e on e.id = m.author_id), '[]'::jsonb);
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
    return null;
  elsif p_action = 'request' then
    if m.status = 'request' then raise exception 'Заявка по сообщению уже создана'; end if;
    v_req := public.create_manual_request(coalesce(nullif(trim(p_title), ''), left(m.text, 200)), m.text, null);
    update master_reports set status = 'request', request_id = (v_req ->> 'id')::bigint, answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return v_req;
  end if;
  raise exception 'Неизвестное действие';
end $$;

update public.master_reports set status = 'read' where status = 'contractor';
alter table public.master_reports drop constraint master_reports_status_check;
alter table public.master_reports add constraint master_reports_status_check
  check (status in ('new', 'read', 'request', 'rejected'));
drop index if exists public.master_reports_about_idx;
alter table public.master_reports drop column about_request;
