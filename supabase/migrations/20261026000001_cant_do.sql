-- «Не могу выполнить» (мастер, меню «⋯»): причина + обязательный комментарий, без работ и фото.
--  * «Нет материалов» — заявка сразу «Ждёт материалы» (paused, hold_reason = 'materials'; комментарий — в событиях заявки),
--    мастер свободен; продолжить — мастер («Продолжить») или руководитель («Вернуть в работу») через resume_request.
--  * «Заявка не нужна» — просьба руководителю (master_reports, kind = 'close'); закрывает только руководитель.
--  * «Нужен подрядчик» — прежняя просьба request_contractor (kind = 'contractor').
-- Только добавляет. Откат: supabase/rollback/20261026000001_cant_do_down.sql

alter table public.requests drop constraint requests_hold_check;
alter table public.requests add constraint requests_hold_check
  check (((status = 'paused') = (hold_reason is not null))
         and (hold_reason is null or hold_reason = any (array['urgent', 'returned', 'pause', 'materials'])));

alter table public.master_reports add column kind text not null default 'report' check (kind in ('report', 'contractor', 'close'));
update public.master_reports set kind = 'contractor' where about_request is not null;
alter table public.master_reports drop constraint master_reports_status_check;
alter table public.master_reports add constraint master_reports_status_check
  check (status in ('new', 'read', 'request', 'rejected', 'contractor', 'closed'));

/** Мастер: «Не могу выполнить» по своей заявке в работе. p_reason: materials | not_needed | contractor. */
create function public.cant_do(p_id bigint, p_reason text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id(); r requests; c text := left(trim(coalesce(p_comment, '')), 900);
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if length(c) < 3 then raise exception 'Напишите, почему не можете выполнить'; end if;
  select * into r from requests where id = p_id for update;
  if r.id is null or r.status <> 'in_work' or r.responsible_id is distinct from me or not r.is_open then
    raise exception 'Можно только по своей заявке в работе';
  end if;
  if p_reason = 'materials' then
    update requests set status = 'paused', hold_reason = 'materials', hold_for = null, paused_at = now(),
                        pause_request = null, pause_requested_at = null
    where id = p_id;
    perform public.log_request_event(p_id, 'pause', 'in_work', 'paused', 'Нет материалов: ' || c);
    perform public.resume_next(me);
  elsif p_reason = 'not_needed' then
    if exists (select 1 from master_reports where about_request = p_id and kind = 'close' and status in ('new', 'read')) then
      raise exception 'Просьба уже у руководителя — дождитесь ответа';
    end if;
    insert into master_reports (author_id, text, about_request, kind) values (me, c, p_id, 'close');
    perform public.log_request_event(p_id, 'comment', null, null, 'Прошу закрыть заявку — не нужна: ' || c);
  elsif p_reason = 'contractor' then
    perform public.request_contractor(p_id, c);
  else
    raise exception 'Неизвестная причина';
  end if;
end $$;

create or replace function public.request_contractor(p_id bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id(); r requests; v_id bigint;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Напишите, почему нужен подрядчик'; end if;
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if r.status not in ('in_work', 'paused') or (r.responsible_id is distinct from me
     and not exists (select 1 from request_members m where m.request_id = p_id and m.employee_id = me)) then
    raise exception 'Попросить можно только по своей заявке в работе';
  end if;
  if exists (select 1 from master_reports where about_request = p_id and kind = 'contractor' and status in ('new', 'read')) then
    raise exception 'Просьба уже у руководителя — дождитесь ответа';
  end if;
  insert into master_reports (author_id, text, about_request, kind) values (me, left(trim(p_reason), 1000), p_id, 'contractor') returning id into v_id;
  perform public.log_request_event(p_id, 'comment', null, null, 'Прошу передать подрядчику: ' || left(trim(p_reason), 900));
  return v_id;
end $$;

create or replace function public.my_master_reports() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'text', m.text, 'status', m.status, 'answer', m.answer, 'created_at', m.created_at, 'kind', m.kind,
           'decided_at', m.decided_at, 'request_id', m.request_id,
           'request_number', (select r.number from requests r where r.id = m.request_id),
           'about_request', m.about_request, 'about_number', (select r.number from requests r where r.id = m.about_request),
           'unseen', m.decided_at is not null and m.seen_at is null and m.status <> 'read',
           'photos', public.report_photos(m.id)) order by m.created_at desc), '[]'::jsonb)
  from (select * from master_reports where author_id = public.current_employee_id() order by created_at desc limit 30) m
$$;

create or replace function public.list_master_reports(p_open boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return coalesce((select jsonb_agg(jsonb_build_object(
           'id', m.id, 'text', m.text, 'status', m.status, 'answer', m.answer, 'created_at', m.created_at, 'kind', m.kind,
           'author', e.display_name, 'request_id', m.request_id,
           'request_number', (select r.number from requests r where r.id = m.request_id),
           'about_request', m.about_request, 'about_number', (select r.number from requests r where r.id = m.about_request),
           'photos', public.report_photos(m.id)) order by (m.status in ('new', 'read')) desc, m.created_at desc)
    from (select * from master_reports
          where not p_open or status in ('new', 'read') or created_at > now() - interval '30 days'
          order by created_at desc limit 100) m
    join employees e on e.id = m.author_id), '[]'::jsonb);
end $$;

/** Решение руководителя: read, reject, request (создать заявку), contractor (передать подрядчику), close (закрыть заявку). */
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
    if m.status = 'contractor' then raise exception 'Заявка уже передана подрядчику'; end if;
    perform public.assign_request(m.about_request, null, true);
    update master_reports set status = 'contractor', answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return null;
  elsif p_action = 'close' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;
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

-- фильтр «Ждут материалы» в списке заявок и счётчик на главной руководителя
do $$
declare
  d text; n text; f text;
  pairs text[][] := array[
    array['public.list_requests(text,integer,text,text,smallint,bigint)',
          $r$or p_lifecycle = 'pause_request' and r.pause_request is not null)$r$,
          $r$or p_lifecycle = 'pause_request' and r.pause_request is not null
               or p_lifecycle = 'materials' and r.status = 'paused' and r.hold_reason = 'materials')$r$],
    array['public.my_notifications()',
          $r$'reports', (select count(*)::int from master_reports m where m.status = 'new'),$r$,
          $r$'reports', (select count(*)::int from master_reports m where m.status = 'new'),
      'materials', (select count(*)::int from requests r where r.status = 'paused' and r.hold_reason = 'materials' and r.is_open),$r$]
  ];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][2], f; end if;
    execute n;
  end loop;
end $$;

revoke all on function public.cant_do(bigint, text, text) from public, anon;
grant execute on function public.cant_do(bigint, text, text) to authenticated;
