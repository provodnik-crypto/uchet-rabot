-- Откат 20261012000001_request_time.sql: возвращает функции к прежнему виду и удаляет добавленное.
-- ВНИМАНИЕ: отметки времени, планы и статусы заявок удаляются безвозвратно.
begin;
create or replace function public.submit_shift(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me          bigint := public.current_employee_id();
  v_uuid      uuid;
  v_date      date;
  v_shift     shifts%rowtype;
  v_entry     jsonb;
  v_pos       int := 0;
  v_req_num   text;
  v_req_id    bigint;
  v_item      price_items%rowtype;
  v_unit      units%rowtype;
  v_qty       numeric;
  v_price     bigint;
  v_entry_id  bigint;
  v_perf      bigint[];
  v_emp       bigint;
  v_pending   int := 0;
  i           int;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  begin
    v_uuid := (payload ->> 'client_uuid')::uuid;
    v_date := (payload ->> 'work_date')::date;
  exception when others then
    raise exception 'Неверные данные смены';
  end;
  if v_uuid is null or v_date is null then raise exception 'Неверные данные смены'; end if;
  if jsonb_typeof(coalesce(payload -> 'entries', '[]')) <> 'array' or jsonb_array_length(coalesce(payload -> 'entries', '[]')) = 0 then
    raise exception 'В смене нет ни одной работы';
  end if;
  if jsonb_array_length(coalesce(payload -> 'entries', '[]')) > 100 then raise exception 'Слишком много работ в одной смене'; end if;

  select * into v_shift from shifts where client_uuid = v_uuid for update;
  if found then
    if v_shift.author_id <> me then raise exception 'Нет доступа' using errcode = '42501'; end if;
    if (v_shift.submitted_at at time zone public.app_timezone())::date <> public.app_today() and not public.is_manager() then
      raise exception 'Смену можно изменить только в день отправки. Обратитесь к руководителю.';
    end if;
    if exists (select 1 from work_entries e left join entry_money m on m.entry_id = e.id
               where e.shift_id = v_shift.id and (e.status = 'rejected' or m.price_source = 'manual')) then
      raise exception 'Руководитель уже обработал работы этой смены, изменить её нельзя.';
    end if;
  end if;

  if not public.is_manager() and v_date not in (public.app_today(), public.app_today() - 1) then
    raise exception 'Дата смены — сегодня или вчера';
  end if;

  if v_shift.id is null then
    insert into shifts (work_date, author_id, client_uuid) values (v_date, me, v_uuid) returning * into v_shift;
  else
    delete from work_entries where shift_id = v_shift.id;
    update shifts set work_date = v_date, updated_at = now() where id = v_shift.id;
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(payload -> 'entries', '[]')) loop
    v_pos := v_pos + 1;

    -- заявка: справочник пополняется номерами, которые вводят мастера
    v_req_id := null;
    v_req_num := upper(nullif(trim(v_entry ->> 'request_number'), ''));
    if v_req_num is not null then
      if v_req_num !~ '^(RFS|INC)\d{6}_\d{4}$' then
        raise exception 'Работа %: номер заявки % в неверном формате', v_pos, v_req_num;
      end if;
      insert into requests (number, created_by) values (v_req_num, me) on conflict (number) do nothing;
      select id into v_req_id from requests where number = v_req_num;
    end if;

    if not exists (select 1 from departments where id = (v_entry ->> 'department_id')::smallint and is_active) then
      raise exception 'Работа %: выберите отдел', v_pos;
    end if;

    begin
      v_qty := (v_entry ->> 'quantity')::numeric;
    exception when others then
      raise exception 'Работа %: объём должен быть числом', v_pos;
    end;
    if v_qty is null or v_qty <= 0 then raise exception 'Работа %: объём должен быть больше нуля', v_pos; end if;
    if v_qty <> round(v_qty, 3) then raise exception 'Работа %: не больше трёх знаков после запятой', v_pos; end if;

    if v_entry ? 'price_item_id' and v_entry ->> 'price_item_id' is not null then
      select * into v_item from price_items
      where id = (v_entry ->> 'price_item_id')::bigint and is_active and not is_material;
      if not found then raise exception 'Работа %: позиция прайса не найдена или выключена', v_pos; end if;
      select * into v_unit from units where id = v_item.unit_id;
      v_price := public.price_on(v_item.id, v_date);
      if v_price is null then raise exception 'Работа %: у позиции «%» нет цены на эту дату', v_pos, v_item.short_name; end if;
    else
      v_item := null;
      if length(trim(coalesce(v_entry ->> 'custom_name', ''))) < 3 then
        raise exception 'Работа %: введите название работы (не короче 3 букв)', v_pos;
      end if;
      select * into v_unit from units where id = (v_entry ->> 'unit_id')::smallint;
      if not found then raise exception 'Работа %: выберите единицу измерения', v_pos; end if;
      v_price := null;
    end if;
    if v_unit.integer_only and v_qty <> trunc(v_qty) then
      raise exception 'Работа %: для «%» объём должен быть целым числом', v_pos, v_unit.code;
    end if;

    -- исполнители: без повторов, только активные мастера
    select array_agg(distinct x::bigint) into v_perf
    from jsonb_array_elements_text(coalesce(v_entry -> 'performer_ids', '[]'::jsonb)) x;
    if v_perf is null or cardinality(v_perf) = 0 then raise exception 'Работа %: выберите исполнителя', v_pos; end if;
    if (select count(*) from employees where id = any (v_perf) and is_active and role in ('master', 'manager')) <> cardinality(v_perf) then
      raise exception 'Работа %: исполнитель не найден или отключён', v_pos;
    end if;

    insert into work_entries (shift_id, position, request_id, department_id, price_item_id, custom_name, unit_id, quantity, note, status)
    values (
      v_shift.id, v_pos, v_req_id, (v_entry ->> 'department_id')::smallint, v_item.id,
      case when v_item.id is null then trim(v_entry ->> 'custom_name') end,
      v_unit.id, v_qty, nullif(trim(v_entry ->> 'note'), ''),
      case when v_item.id is null then 'pending' else 'priced' end
    ) returning id into v_entry_id;

    -- порядок исполнителей как в запросе: первый получает остаток копеек
    i := 0;
    for v_emp in
      select x::bigint from jsonb_array_elements_text(v_entry -> 'performer_ids') with ordinality as t(x, n)
      group by x order by min(n)
    loop
      i := i + 1;
      insert into entry_performers (entry_id, employee_id, position, share)
      values (v_entry_id, v_emp, i, round(1.0 / cardinality(v_perf), 6));
    end loop;

    -- фото работы (до 3): файлы уже загружены приложением в хранилище
    perform public.attach_entry_photos(v_entry_id, v_entry -> 'photos', v_pos);

    if v_item.id is not null then
      insert into entry_money (entry_id, unit_price_kop, total_kop, price_source)
      values (v_entry_id, v_price, round(v_qty * v_price)::bigint, 'price_list');
      perform public.recompute_performer_money(v_entry_id);
    else
      v_pending := v_pending + 1;
    end if;
  end loop;

  return jsonb_build_object('shift_id', v_shift.id, 'entries', v_pos, 'pending', v_pending);
end $$;

drop function public.list_requests(text, integer);
create function public.list_requests(q text default '', p_limit integer default 100)
returns table (id bigint, number text, subject text, entries bigint, last_work_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select r.id, r.number, r.subject, count(e.id), max(s.work_date)
    from requests r
    left join work_entries e on e.request_id = r.id
    left join shifts s on s.id = e.shift_id
    where public.search_words_match(public.normalize_search(r.number || ' ' || coalesce(r.subject, '')), q)
    group by r.id
    order by max(s.work_date) desc nulls last, r.created_at desc
    limit least(greatest(p_limit, 1), 300);
end $$;
revoke all on function public.list_requests(text, integer) from public, anon;
grant execute on function public.list_requests(text, integer) to authenticated;

drop function if exists public.time_stats(date, date);
drop function if exists public.set_request_state(bigint, boolean);
drop function if exists public.my_shift_requests(uuid);
drop function if exists public.requests_time(text[], uuid);
drop function if exists public.my_open_requests();
drop table if exists public.shift_requests;
drop function if exists public.shift_requests_after_delete();
drop function if exists public.save_shift_requests(bigint, jsonb);
drop function if exists public.refresh_request_state(bigint);
drop function if exists public.payload_has_time(jsonb);
drop function if exists public.shift_minutes();
revoke update (plan_minutes) on public.requests from authenticated;
alter table public.requests drop column plan_minutes, drop column state, drop column manager_closed_at;
commit;
