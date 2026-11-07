-- Аудит, этап 2: зависающие заявки. Только добавляет (новые функции, триггеры, правки функций);
-- откат — supabase/rollback/20261028000001_stuck_requests_down.sql
--  * закрытие заявки, которая у мастера «В работе»/на паузе, снимает её с мастера (→ «Ожидает», закрыта),
--    мастер освобождается (resume_next); закрытую нельзя отправить на проверку или от неё отказаться;
--  * «Закрыть все» при загрузке ITSM и «Закрыть старые» не закрывают заявки в работе, на паузе, на проверке;
--    в списке «пропали из файла» — статус, мастер и число работ;
--  * отключение мастера: его заявки в работе/на паузе → «Ожидает», назначения и участие напарником снимаются;
--  * просьбы мастеров «закрыть»/«передать подрядчику» по заявке, ушедшей от мастера, закрываются как неактуальные;
--    решить устаревшую нельзя; нерешённые просьбы остаются в счётчике на главной руководителя.

/** Закрыть заявку; если она у мастера в работе или на паузе — снять с мастера. */
create function public.close_request_core(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  select * into r from requests where id = p_id for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if r.status in ('in_work', 'paused') then
    update requests set status = 'waiting', responsible_id = null, taken_at = null, returned_comment = null,
                        hold_reason = null, hold_for = null, paused_at = null, pause_request = null, pause_requested_at = null
    where id = p_id;
    delete from request_members where request_id = p_id;
    perform public.log_request_event(p_id, 'assign', r.status, 'waiting',
      'Заявка закрыта — снята с мастера ' || coalesce((select display_name from employees where id = r.responsible_id), ''));
  end if;
  update requests set is_open = false, closed_at = now(), closed_by = public.current_employee_id() where id = p_id;
  if r.status = 'in_work' then perform public.resume_next(r.responsible_id); end if;
end $$;

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

/** Сколько старых заявок «Закрыть старые» пропустит: они у мастеров в работе, на паузе или на проверке. */
create function public.old_open_skipped(p_before date) returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return (select count(*)::int from requests r where r.source = 'itsm' and r.is_open and r.registered_at < p_before
          and r.status in ('in_work', 'paused', 'review'));
end $$;

-- ---------- Отключение мастера ----------
/** Снять с сотрудника его заявки: в работе/на паузе → «Ожидает», назначения и участие напарником — снять. */
create function public.release_employee_requests_core(p_emp bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare r requests; n integer := 0;
begin
  for r in select * from requests where responsible_id = p_emp and status in ('in_work', 'paused') for update loop
    update requests set status = 'waiting', responsible_id = null, taken_at = null, returned_comment = null,
                        hold_reason = null, hold_for = null, paused_at = null, pause_request = null, pause_requested_at = null
    where id = r.id;
    delete from request_members where request_id = r.id;
    perform public.log_request_event(r.id, 'assign', r.status, 'waiting', 'Мастер отключён — заявка снова свободна');
    n := n + 1;
  end loop;
  update requests set assignee_id = null where assignee_id = p_emp and status = 'waiting';
  delete from request_members where employee_id = p_emp;
  return n;
end $$;
revoke all on function public.release_employee_requests_core(bigint) from public, anon, authenticated;

/** Руководитель перед отключением: открытые заявки мастера (для подтверждения). */
create function public.employee_open_requests(p_emp bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'status', r.status,
                 'awaiting', (select count(*)::int from work_entries w where w.request_id = r.id and w.status = 'awaiting')) order by r.number)
               from requests r where r.responsible_id = p_emp and r.status in ('in_work', 'paused')), '[]'::jsonb),
    'assigned', (select count(*)::int from requests r where r.assignee_id = p_emp and r.status = 'waiting' and r.is_open));
end $$;

/** Руководитель: снять заявки с мастера (перед отключением); p_credit — засчитать ли работы «ждут приёмки». */
create function public.release_employee_requests(p_emp bigint, p_credit boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  perform public.require_manager();
  if p_credit is not null then
    for v in select id from requests where responsible_id = p_emp and status in ('in_work', 'paused') loop
      perform public.settle_request_works(v, p_credit);
    end loop;
  end if;
  return public.release_employee_requests_core(p_emp);
end $$;

/** Отключили сотрудника любым путём — его заявки не зависают. */
create function public.employees_release_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_active and not new.is_active then perform public.release_employee_requests_core(new.id); end if;
  return new;
end $$;
create trigger employees_release after update of is_active on public.employees
  for each row execute function public.employees_release_tg();

-- ---------- Просьбы мастеров по заявке ----------
/** Заявка ушла от мастера — его открытые просьбы «закрыть» / «передать подрядчику» по ней неактуальны. */
create function public.requests_stale_asks_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update master_reports m set status = 'rejected', answer = 'Неактуально: заявка уже не у вас в работе',
         decided_at = now(), seen_at = null
  where m.about_request = new.id and m.status in ('new', 'read') and m.kind in ('contractor', 'close')
    and not (new.is_open and new.status in ('in_work', 'paused')
             and (new.responsible_id = m.author_id
                  or exists (select 1 from request_members x where x.request_id = new.id and x.employee_id = m.author_id)));
  return null;
end $$;
create trigger requests_stale_asks after update of status, responsible_id, is_open on public.requests
  for each row execute function public.requests_stale_asks_tg();

-- ---------- Правки функций (по тексту) ----------
do $$
declare
  d text; n text; f text;
  pairs text[][] := array[
    -- загрузка ITSM: «Закрыть все» не трогает заявки у мастеров
    array['public.request_import_apply(jsonb)',
          $r$      and r.source = 'itsm' and r.is_open;$r$,
          $r$      and r.source = 'itsm' and r.is_open and r.status not in ('in_work', 'paused', 'review');$r$],
    array['public.request_import_context(text[])',
          $r$'description', r.description, 'registered_at', r.registered_at)$r$,
          $r$'description', r.description, 'registered_at', r.registered_at, 'status', r.status,
                                          'master', (select e.display_name from employees e where e.id = r.responsible_id),
                                          'works', (select count(*)::int from work_entries we where we.request_id = r.id and we.status <> 'rejected'))$r$],
    -- «Закрыть старые»: только «Ожидает», у подрядчика, принятые
    array['public.close_old_requests(date)',
          $r$  where r.source = 'itsm' and r.is_open and r.registered_at < p_before;$r$,
          $r$  where r.source = 'itsm' and r.is_open and r.registered_at < p_before and r.status not in ('in_work', 'paused', 'review');$r$],
    array['public.old_open_requests(date)',
          $r$    where r.source = 'itsm' and r.is_open and r.registered_at < p_before$r$,
          $r$    where r.source = 'itsm' and r.is_open and r.registered_at < p_before and r.status not in ('in_work', 'paused', 'review')$r$],
    -- закрытую заявку не отправить и от неё не отказаться
    array['public.send_request_for_review(bigint,text)',
          $r$status = 'in_work' and responsible_id = me) then$r$,
          $r$status = 'in_work' and responsible_id = me and is_open) then$r$],
    array['public.send_request_for_review_photos(bigint,text,jsonb)',
          $r$status = 'in_work' and responsible_id = me) then$r$,
          $r$status = 'in_work' and responsible_id = me and is_open) then$r$],
    array['public.refuse_request(bigint,text)',
          $r$  where id = p_id and status = 'in_work' and responsible_id = me;$r$,
          $r$  where id = p_id and status = 'in_work' and responsible_id = me and is_open;$r$],
    -- нерешённые просьбы «закрыть» / «передать подрядчику» остаются в счётчике на главной
    array['public.my_notifications()',
          $r$'reports', (select count(*)::int from master_reports m where m.status = 'new'),$r$,
          $r$'reports', (select count(*)::int from master_reports m where m.status = 'new' or (m.status = 'read' and m.kind in ('contractor', 'close'))),$r$],
    -- решить устаревшую просьбу нельзя
    array['public.decide_master_report(bigint,text,text,text)',
          $r$  elsif p_action = 'contractor' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;$r$,
          $r$  elsif p_action = 'contractor' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;
    if m.status not in ('new', 'read') then raise exception 'Просьба уже решена или устарела'; end if;$r$],
    array['public.decide_master_report(bigint,text,text,text)',
          $r$  elsif p_action = 'close' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;$r$,
          $r$  elsif p_action = 'close' then
    if m.about_request is null then raise exception 'Сообщение не про заявку'; end if;
    if m.status not in ('new', 'read') then raise exception 'Просьба уже решена или устарела'; end if;$r$]
  ];
  i int;
  defs jsonb := '{}';
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := coalesce(defs ->> f, pg_get_functiondef(f::regprocedure));
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][2], f; end if;
    defs := defs || jsonb_build_object(f, n);
  end loop;
  for f in select jsonb_object_keys(defs) loop execute defs ->> f; end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.old_open_skipped(date)', 'public.employee_open_requests(bigint)',
                           'public.release_employee_requests(bigint, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.close_request_core(bigint) from public, anon, authenticated;
