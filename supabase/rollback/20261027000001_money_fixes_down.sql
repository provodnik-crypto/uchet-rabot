-- Откат 20261027000001_money_fixes: прежние версии функций.
drop function if exists public.settle_request_works(bigint, boolean);
CREATE OR REPLACE FUNCTION public.add_request_work(p_request bigint, p_entry jsonb, p_replace bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  r requests;
  s shifts;
  old work_entries;
  v_id bigint;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
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
  update requests set last_activity_at = now() where id = p_request;
  return v_id;
end $function$

;

CREATE OR REPLACE FUNCTION public.refuse_request(p_id bigint, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me bigint := public.current_employee_id();
begin
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите, почему отказываетесь'; end if;
  update requests set status = 'waiting', responsible_id = null, taken_at = null, returned_comment = null,
                      pause_request = null, pause_requested_at = null
  where id = p_id and status = 'in_work' and responsible_id = me;
  if not found then raise exception 'Отказаться может только мастер, который взял заявку'; end if;
  delete from request_members where request_id = p_id;
  perform public.log_request_event(p_id, 'refuse', 'in_work', 'waiting', p_comment);
  perform public.resume_next(me);
end $function$

;

CREATE OR REPLACE FUNCTION public.submit_shift(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me bigint := public.current_employee_id();
  v_num text;
  v_req bigint;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
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
end $function$

;

CREATE OR REPLACE FUNCTION public.claim_request_for_work(p_request bigint, p_author bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r requests;
begin
  select * into r from requests where id = p_request for update;
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
  elsif r.status in ('in_work', 'review', 'paused') and r.responsible_id <> p_author then
    -- работы по заявке вносит только взявший её; напарники лишь числятся
    raise exception 'Заявку % взял %', r.number, (select display_name from employees where id = r.responsible_id);
  end if;
  -- accepted и свои in_work/review/paused — без изменений (правка смены в тот же день, время до приостановки)
end $function$

;

CREATE OR REPLACE FUNCTION public.resubmit_entry(p_entry bigint, p_custom_name text, p_unit_id smallint, p_quantity numeric, p_note text, p_price_item_id bigint DEFAULT NULL::bigint, p_photos jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e work_entries%rowtype;
  it price_items%rowtype;
  v_date date;
  v_price bigint;
begin
  select e2.* into e from work_entries e2 join shifts s on s.id = e2.shift_id
   where e2.id = p_entry and s.author_id = public.current_employee_id() for update of e2;
  if not found then raise exception 'Работа не найдена' using errcode = '42501'; end if;
  if e.status <> 'rejected' then raise exception 'Исправить можно только отклонённую работу'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Объём должен быть больше нуля'; end if;
  select work_date into v_date from shifts where id = e.shift_id;

  -- фото: null — не трогать; массив — заменить набор (оставленные старые + новые)
  if p_photos is not null then
    delete from entry_photos where entry_id = e.id;
    perform public.attach_entry_photos(e.id, p_photos, 1);
  end if;

  if p_price_item_id is not null then
    select * into it from price_items where id = p_price_item_id and is_active and not is_material;
    if not found then raise exception 'Позиция прайса не найдена или выключена'; end if;
    v_price := public.price_on(it.id, v_date);
    if v_price is null then raise exception 'У позиции нет цены на дату работы'; end if;
    update work_entries set price_item_id = it.id, custom_name = null, unit_id = it.unit_id, quantity = p_quantity,
           note = nullif(trim(p_note), ''), status = 'priced', reject_comment = null
     where id = e.id;
    insert into entry_money (entry_id, unit_price_kop, total_kop, price_source)
    values (e.id, v_price, greatest(round(p_quantity * v_price), 1)::bigint, 'price_list');
    perform public.recompute_performer_money(e.id);
  else
    if length(trim(coalesce(p_custom_name, ''))) < 3 then raise exception 'Введите название работы (не короче 3 букв)'; end if;
    if not exists (select 1 from units where id = p_unit_id) then raise exception 'Выберите единицу измерения'; end if;
    update work_entries set custom_name = trim(p_custom_name), unit_id = p_unit_id, quantity = p_quantity,
           note = nullif(trim(p_note), ''), status = 'pending', reject_comment = null
     where id = e.id;
  end if;
end $function$

;

drop index if exists public.work_entries_client_key_uq;
alter table public.work_entries drop column client_key;
CREATE OR REPLACE FUNCTION public.send_request_for_review(p_id bigint, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me bigint := public.current_employee_id();
begin
  if not exists (select 1 from requests where id = p_id and status = 'in_work' and responsible_id = me) then
    raise exception 'Отправить может только мастер, который взял заявку';
  end if;
  if not exists (select 1 from work_entries where request_id = p_id and status <> 'rejected') then
    raise exception 'Добавьте хотя бы одну работу по заявке';
  end if;
  update requests set status = 'review', sent_at = now(), returned_comment = null, pause_request = null, pause_requested_at = null
  where id = p_id;
  perform public.log_request_event(p_id, 'send', 'in_work', 'review', p_comment);
  perform public.resume_next(me);
end $function$;

drop function if exists public.legacy_shift_allowed();
