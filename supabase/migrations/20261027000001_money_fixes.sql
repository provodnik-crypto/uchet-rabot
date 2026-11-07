-- Этап «деньги и дубли» (аудит 22.10.2026). Только добавляет и закрывает обходные пути; откат —
-- supabase/rollback/20261027000001_money_fixes_down.sql
--  * add_request_work: одноразовый ключ работы (p_entry.client_key) — повтор после обрыва связи не создаёт дубль;
--  * settle_request_works: руководитель решает, засчитать ли работы «ждут приёмки», когда заявку передают
--    подрядчику или закрывают (иначе они висели бы навсегда);
--  * refuse_request: при отказе несданные работы мастера по заявке удаляются (не достаются следующему);
--  * submit_shift (старые версии, черновики): только в свою заявку «В работе», без работ без заявки,
--    без перезаписи «дня» и уже отправленных работ; claim_request_for_work — не в закрытую/принятую/на проверке;
--  * resubmit_entry: исправить отклонённую работу мастер может только в своей заявке «В работе»;
--  * send_request_for_review: без фото результата не отправить и при прямом вызове.

/** Старое поведение «Закрыть смену» — только для тестов базы, проверяющих расчёт денег через неё
    (настройку uchet.allow_legacy_shift нельзя задать через API приложения). */
create function public.legacy_shift_allowed() returns boolean
language sql stable as $$ select coalesce(current_setting('uchet.allow_legacy_shift', true), '') = 'on' $$;

alter table public.work_entries add column client_key uuid;
create unique index work_entries_client_key_uq on public.work_entries (client_key) where client_key is not null;

create or replace function public.add_request_work(p_request bigint, p_entry jsonb, p_replace bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  r requests;
  s shifts;
  old work_entries;
  v_id bigint;
  v_key uuid;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  -- повтор того же нажатия (ответ не дошёл) — вернуть уже сохранённую работу
  if nullif(p_entry ->> 'client_key', '') is not null then
    v_key := (p_entry ->> 'client_key')::uuid;
    select w.id into v_id from work_entries w join shifts sh on sh.id = w.shift_id where w.client_key = v_key and sh.author_id = me;
    if v_id is not null then return v_id; end if;
  end if;
  select * into r from requests where id = p_request for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if r.status <> 'in_work' or r.responsible_id is distinct from me or not r.is_open then
    raise exception 'Работы вносит мастер, у которого заявка «В работе»';
  end if;
  if p_replace is not null then
    old := public.my_editable_entry(p_replace);
    if old.id is null or old.request_id <> p_request then raise exception 'Эту работу уже нельзя изменить'; end if;
    select * into s from shifts where id = old.shift_id for update;
    delete from work_entries where id = old.id;   -- фото уходят в корзину триггером; новые снова привяжутся
  else
    s := public.day_shift(me, public.app_today());
  end if;
  v_id := public.insert_work_entry(s, p_request, p_entry);
  if v_key is not null then update work_entries set client_key = v_key where id = v_id; end if;
  update requests set last_activity_at = now() where id = p_request;
  return v_id;
end $$;

/** Работы «ждут приёмки» заявки, которую не примут (подрядчик, закрытие): засчитать мастеру или нет. */
create function public.settle_request_works(p_id bigint, p_credit boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.require_manager();
  if p_credit then
    update work_entries set needs_acceptance = false, status = 'priced' where request_id = p_id and status = 'awaiting';
  else
    update work_entries set status = 'rejected', reject_comment = 'Не засчитано: заявку закрыли или передали подрядчику'
    where request_id = p_id and status = 'awaiting';
  end if;
  get diagnostics n = row_count;
  if n > 0 then
    perform public.log_request_event(p_id, 'comment', null, null,
      case when p_credit then 'Засчитано мастеру работ: ' else 'Не засчитано работ: ' end || n);
  end if;
  return n;
end $$;

create or replace function public.refuse_request(p_id bigint, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id(); v_shifts bigint[]; n integer;
begin
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, почему отказываетесь'; end if;
  update requests set status = 'waiting', responsible_id = null, taken_at = null, returned_comment = null,
                      pause_request = null, pause_requested_at = null
  where id = p_id and status = 'in_work' and responsible_id = me;
  if not found then raise exception 'Отказаться может только мастер, который взял заявку'; end if;
  -- несданные работы по заявке удаляются: следующий мастер начинает с чистой заявки
  select array_agg(distinct shift_id) into v_shifts from work_entries where request_id = p_id and status in ('awaiting', 'pending');
  delete from work_entries where request_id = p_id and status in ('awaiting', 'pending');
  get diagnostics n = row_count;
  delete from shifts x where x.id = any (coalesce(v_shifts, '{}')) and not exists (select 1 from work_entries where shift_id = x.id)
    and not exists (select 1 from shift_requests where shift_id = x.id);
  delete from request_members where request_id = p_id;
  perform public.log_request_event(p_id, 'refuse', 'in_work', 'waiting',
    p_comment || case when n > 0 then ' (удалено работ: ' || n || ')' else '' end);
  perform public.resume_next(me);
end $$;

create or replace function public.claim_request_for_work(p_request bigint, p_author bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  select * into r from requests where id = p_request for update;
  if not r.is_open and not public.legacy_shift_allowed() then raise exception 'Заявка % закрыта', r.number; end if;
  if r.status = 'waiting' then
    if r.to_contractor then raise exception 'Заявка % у подрядчика', r.number; end if;
    if r.assignee_id is not null and r.assignee_id <> p_author then
      raise exception 'Заявка % назначена: %', r.number, (select display_name from employees where id = r.assignee_id);
    end if;
    perform public.assert_free(p_author, p_request, true);
    update requests set status = 'in_work', responsible_id = p_author, taken_at = now(), returned_comment = null
    where id = p_request;
    insert into request_events (request_id, kind, author_id, from_status, to_status)
    values (p_request, 'take', p_author, 'waiting', 'in_work');
  elsif r.status = 'contractor' then
    raise exception 'Заявка % у подрядчика', r.number;
  elsif r.responsible_id is distinct from p_author then
    raise exception 'Заявку % взял %', r.number, coalesce((select display_name from employees where id = r.responsible_id), 'другой мастер');
  elsif r.status <> 'in_work' and not public.legacy_shift_allowed() then
    -- принятая, на проверке, приостановленная: работы в неё больше не вносятся
    raise exception 'Заявка % уже не в работе — работы вносятся только в заявку «В работе»', r.number;
  end if;
end $$;

-- Старая «Закрыть смену» (черновики прошлых версий): только в свою заявку «В работе».
create or replace function public.submit_shift(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_num text;
  v_req bigint;
  v_uuid uuid := nullif(payload ->> 'client_uuid', '')::uuid;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if not public.is_manager() and not public.legacy_shift_allowed() then
    if exists (select 1 from jsonb_array_elements(coalesce(payload -> 'entries', '[]')) x where nullif(trim(x ->> 'request_number'), '') is null) then
      raise exception 'Работы без заявки больше не вносятся — внесите их в карточке своей заявки';
    end if;
    -- «день» мастера и смены с уже отправленными/принятыми работами переписывать нельзя
    if v_uuid is not null and exists (
      select 1 from shifts s where s.client_uuid = v_uuid and s.author_id = me
        and (s.client_uuid = public.day_shift_uuid(me, s.work_date)
             or exists (select 1 from work_entries w join requests r on r.id = w.request_id
                        where w.shift_id = s.id and r.status <> 'in_work'))) then
      raise exception 'Эту смену уже нельзя изменить — работы вносятся в карточке заявки';
    end if;
  end if;
  if not public.is_manager() then
    for v_num in
      select distinct upper(trim(x ->> 'request_number'))
      from jsonb_array_elements(coalesce(payload -> 'entries', '[]')) x
      where nullif(trim(x ->> 'request_number'), '') is not null
    loop
      if not public.valid_request_number(v_num) then raise exception 'Номер заявки % в неверном формате', v_num; end if;
      select id into v_req from requests where number = v_num;
      if v_req is null then raise exception 'Заявка % не найдена. Номер вводить не нужно — сообщите руководителю', v_num; end if;
      perform public.claim_request_for_work(v_req, me);
    end loop;
  end if;
  return public.submit_shift_core(payload);
end $$;

-- Исправить отклонённую работу мастер может только в своей заявке «В работе» (иначе — руководитель).
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.resubmit_entry(bigint,text,smallint,numeric,text,bigint,jsonb)'::regprocedure);
  n := replace(d, $r$if e.status <> 'rejected' then raise exception 'Исправить можно только отклонённую работу'; end if;$r$,
    $r$if e.status <> 'rejected' then raise exception 'Исправить можно только отклонённую работу'; end if;
  if not public.is_manager() and not public.legacy_shift_allowed() and not exists (select 1 from requests r where r.id = e.request_id and r.status = 'in_work'
       and r.responsible_id = public.current_employee_id() and r.is_open) then
    raise exception 'Заявка уже не у вас в работе — исправить эту работу может руководитель';
  end if;$r$);
  if n = d then raise exception 'Не нашёл место для проверки в resubmit_entry'; end if;
  execute n;
end $$;

revoke all on function public.settle_request_works(bigint, boolean) from public, anon;
grant execute on function public.settle_request_works(bigint, boolean) to authenticated;
-- отправка без фото результата невозможна и при прямом вызове старой функции
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.send_request_for_review(bigint,text)'::regprocedure);
  n := replace(d, $r$  if not exists (select 1 from work_entries where request_id = p_id and status <> 'rejected') then$r$,
    $r$  if not public.legacy_shift_allowed()
     and not exists (select 1 from extra_photos x where x.owner_kind = 'result' and x.owner_id = p_id) then
    raise exception 'Добавьте фото результата';
  end if;
  if not exists (select 1 from work_entries where request_id = p_id and status <> 'rejected') then$r$);
  if n = d then raise exception 'Не нашёл место для проверки в send_request_for_review'; end if;
  execute n;
end $$;
