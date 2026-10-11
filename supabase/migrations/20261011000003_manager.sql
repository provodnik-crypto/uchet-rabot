-- Этап 4: руководитель — очередь «На оценке», журнал работ, сводки, заявки.
-- Все функции с деньгами проверяют роль руководителя.

create or replace function public.require_manager() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Доступно только руководителю' using errcode = '42501'; end if;
end $$;

-- ---------- Очередь «На оценке» ----------
create or replace function public.pending_queue()
returns table (
  entry_id bigint, work_date date, submitted_at timestamptz, request_number text, department_name text,
  custom_name text, unit_id smallint, unit_code text, quantity numeric, note text,
  author_name text, performer_names text, hint_price_kop bigint, hint_date date
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select e.id, s.work_date, s.submitted_at, r.number, d.name, e.custom_name, u.id, u.code, e.quantity, e.note,
           a.display_name,
           (select string_agg(emp.display_name, ', ' order by ep.position)
              from entry_performers ep join employees emp on emp.id = ep.employee_id where ep.entry_id = e.id),
           h.unit_price_kop, h.work_date
    from work_entries e
    join shifts s on s.id = e.shift_id
    join employees a on a.id = s.author_id
    join departments d on d.id = e.department_id
    join units u on u.id = e.unit_id
    left join requests r on r.id = e.request_id
    -- подсказка: последняя цена такой же работы вне прайса с той же единицей
    left join lateral (
      select m.unit_price_kop, s2.work_date
      from work_entries e2 join entry_money m on m.entry_id = e2.id join shifts s2 on s2.id = e2.shift_id
      where e2.custom_name is not null and e2.status = 'priced' and e2.unit_id = e.unit_id
        and regexp_replace(public.normalize_search(e2.custom_name), '\s+', ' ', 'g')
          = regexp_replace(public.normalize_search(e.custom_name), '\s+', ' ', 'g')
      order by s2.work_date desc, e2.id desc limit 1
    ) h on true
    where e.status = 'pending'
    order by s.work_date, e.id;
end $$;

-- Назначить цену работе вне прайса. p_add_to_price — добавить её в прайс (категория «Добавлено вручную»).
create or replace function public.price_pending_entry(p_entry bigint, p_unit_price_kop bigint, p_add_to_price boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e work_entries%rowtype;
  v_date date;
  v_item bigint;
begin
  perform public.require_manager();
  if p_unit_price_kop is null or p_unit_price_kop <= 0 then raise exception 'Цена должна быть больше нуля'; end if;
  select * into e from work_entries where id = p_entry for update;
  if not found or e.status <> 'pending' then raise exception 'Работа уже обработана или не найдена'; end if;
  select work_date into v_date from shifts where id = e.shift_id;

  insert into entry_money (entry_id, unit_price_kop, total_kop, price_source, priced_by)
  values (e.id, p_unit_price_kop, greatest(round(e.quantity * p_unit_price_kop), 1)::bigint, 'manual', public.current_employee_id());
  update work_entries set status = 'priced', reject_comment = null where id = e.id;
  perform public.recompute_performer_money(e.id);

  if p_add_to_price then
    if exists (select 1 from price_items where full_name = e.custom_name) then
      raise exception 'Позиция «%» уже есть в прайсе', e.custom_name;
    end if;
    insert into price_items (full_name, short_name, category, unit_id, origin)
    values (e.custom_name, e.custom_name, 'Добавлено вручную', e.unit_id, 'manual')
    returning id into v_item;
    insert into price_item_prices (price_item_id, price_kop, valid_from, created_by)
    values (v_item, p_unit_price_kop, least(v_date, public.app_today()), public.current_employee_id());
  end if;
end $$;

-- Заменить работу вне прайса на позицию прайса. Если единица другая — нужен новый объём.
create or replace function public.replace_entry_with_item(p_entry bigint, p_item bigint, p_quantity numeric default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e work_entries%rowtype;
  it price_items%rowtype;
  v_date date;
  v_qty numeric;
  v_price bigint;
begin
  perform public.require_manager();
  select * into e from work_entries where id = p_entry for update;
  if not found or e.status <> 'pending' then raise exception 'Работа уже обработана или не найдена'; end if;
  select * into it from price_items where id = p_item and is_active and not is_material;
  if not found then raise exception 'Позиция прайса не найдена или выключена'; end if;
  if it.unit_id <> e.unit_id and p_quantity is null then
    raise exception 'Единица другая (%): укажите объём', (select code from units where id = it.unit_id);
  end if;
  v_qty := coalesce(p_quantity, e.quantity);
  select work_date into v_date from shifts where id = e.shift_id;
  v_price := public.price_on(it.id, v_date);
  if v_price is null then raise exception 'У позиции нет цены на дату работы'; end if;

  update work_entries
     set price_item_id = it.id, custom_name = null, unit_id = it.unit_id, quantity = v_qty,
         status = 'priced', reject_comment = null
   where id = e.id;
  insert into entry_money (entry_id, unit_price_kop, total_kop, price_source, priced_by)
  values (e.id, v_price, greatest(round(v_qty * v_price), 1)::bigint, 'price_list', public.current_employee_id());
  perform public.recompute_performer_money(e.id);
end $$;

create or replace function public.reject_entry(p_entry bigint, p_comment text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_manager();
  if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите мастеру, почему работа отклонена'; end if;
  update work_entries set status = 'rejected', reject_comment = trim(p_comment)
   where id = p_entry and status = 'pending';
  if not found then raise exception 'Работа уже обработана или не найдена'; end if;
end $$;

-- Мастер исправляет отклонённую работу и отправляет повторно (снова «На оценке»
-- или сразу «Принято», если выбрал позицию прайса).
create or replace function public.resubmit_entry(
  p_entry bigint, p_custom_name text, p_unit_id smallint, p_quantity numeric, p_note text, p_price_item_id bigint default null
) returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- ---------- Журнал работ для руководителя (с деньгами) ----------
create or replace function public.admin_entries(
  p_from date, p_to date, p_employee bigint default null, p_department smallint default null,
  p_request text default null, p_status text default null, p_limit integer default 50, p_offset integer default 0
)
returns table (
  entry_id bigint, shift_id bigint, work_date date, request_number text, department_id smallint, department_name text,
  price_item_id bigint, name text, is_custom boolean, unit_code text, integer_only boolean, quantity numeric, note text, status text,
  reject_comment text, is_imported boolean, unit_price_kop bigint, total_kop bigint, performer_ids bigint[],
  performer_names text, author_name text, total_rows bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select e.id, s.id, s.work_date, r.number, d.id, d.name, e.price_item_id, coalesce(p.short_name, e.custom_name),
           e.price_item_id is null, u.code, u.integer_only, e.quantity, e.note, e.status, e.reject_comment, e.is_imported,
           m.unit_price_kop, m.total_kop,
           (select array_agg(ep.employee_id order by ep.position) from entry_performers ep where ep.entry_id = e.id),
           (select string_agg(emp.display_name, ', ' order by ep.position)
              from entry_performers ep join employees emp on emp.id = ep.employee_id where ep.entry_id = e.id),
           a.display_name,
           count(*) over ()
    from work_entries e
    join shifts s on s.id = e.shift_id
    join employees a on a.id = s.author_id
    join departments d on d.id = e.department_id
    join units u on u.id = e.unit_id
    left join price_items p on p.id = e.price_item_id
    left join requests r on r.id = e.request_id
    left join entry_money m on m.entry_id = e.id
    where s.work_date between p_from and p_to
      and (p_employee is null or exists (select 1 from entry_performers ep where ep.entry_id = e.id and ep.employee_id = p_employee))
      and (p_department is null or e.department_id = p_department)
      and (p_request is null or r.number ilike '%' || trim(p_request) || '%')
      and (p_status is null or e.status = p_status)
    order by s.work_date desc, s.id desc, e.position
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- Правка записи руководителем: объём, отдел, примечание, исполнители. Цена за единицу не меняется.
create or replace function public.admin_update_entry(
  p_entry bigint, p_quantity numeric, p_department smallint, p_note text, p_performer_ids bigint[]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  e work_entries%rowtype;
  v_ids bigint[];
  i int := 0;
  v_emp bigint;
begin
  perform public.require_manager();
  select * into e from work_entries where id = p_entry for update;
  if not found then raise exception 'Работа не найдена'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Объём должен быть больше нуля'; end if;
  if not exists (select 1 from departments where id = p_department) then raise exception 'Выберите отдел'; end if;
  select array_agg(x) into v_ids from (select distinct unnest(p_performer_ids) x) t;
  if v_ids is null then raise exception 'Выберите исполнителя'; end if;
  if (select count(*) from employees where id = any (v_ids)) <> cardinality(v_ids) then raise exception 'Исполнитель не найден'; end if;

  update work_entries set quantity = p_quantity, department_id = p_department, note = nullif(trim(p_note), '') where id = e.id;
  delete from entry_performers where entry_id = e.id;
  for v_emp in select x from unnest(p_performer_ids) with ordinality t(x, n) group by x order by min(n) loop
    i := i + 1;
    insert into entry_performers (entry_id, employee_id, position, share) values (e.id, v_emp, i, round(1.0 / cardinality(v_ids), 6));
  end loop;
  update entry_money set total_kop = greatest(round(p_quantity * unit_price_kop), 1)::bigint where entry_id = e.id;
  perform public.recompute_performer_money(e.id);
end $$;

create or replace function public.admin_delete_entry(p_entry bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_shift bigint;
begin
  perform public.require_manager();
  delete from work_entries where id = p_entry returning shift_id into v_shift;
  if v_shift is null then raise exception 'Работа не найдена'; end if;
  delete from shifts s where s.id = v_shift and not exists (select 1 from work_entries where shift_id = v_shift);
end $$;

-- ---------- Сводки (только оценённые работы) ----------
create or replace function public.manager_dashboard()
returns table (pending_count bigint, month_total_kop bigint, month_entries bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', public.app_today())::date;
begin
  perform public.require_manager();
  return query
    select (select count(*) from work_entries where status = 'pending'),
           coalesce((select sum(m.total_kop) from entry_money m join work_entries e on e.id = m.entry_id
                     join shifts s on s.id = e.shift_id where e.status = 'priced' and s.work_date >= v_from), 0)::bigint,
           (select count(*) from work_entries e join shifts s on s.id = e.shift_id
             where e.status = 'priced' and s.work_date >= v_from);
end $$;

-- По сотрудникам: доля в рублях, число работ и смен. В общих итогах сумма считается один раз.
create or replace function public.report_by_employee(p_from date, p_to date)
returns table (employee_id bigint, display_name text, in_output_chart boolean, total_kop bigint, entries bigint, shifts bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select emp.id, emp.display_name, emp.in_output_chart, sum(pm.share_kop)::bigint, count(distinct e.id), count(distinct e.shift_id)
    from performer_money pm
    join work_entries e on e.id = pm.entry_id and e.status = 'priced'
    join shifts s on s.id = e.shift_id
    join employees emp on emp.id = pm.employee_id
    where s.work_date between p_from and p_to
    group by emp.id
    order by 4 desc;
end $$;

create or replace function public.report_by_month(p_from date, p_to date)
returns table (month date, total_kop bigint, entries bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select date_trunc('month', s.work_date)::date, sum(m.total_kop)::bigint, count(*)
    from entry_money m
    join work_entries e on e.id = m.entry_id and e.status = 'priced'
    join shifts s on s.id = e.shift_id
    where s.work_date between p_from and p_to
    group by 1 order by 1;
end $$;

create or replace function public.report_totals(p_from date, p_to date)
returns table (total_kop bigint, entries bigint, pending bigint, rejected bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select coalesce(sum(m.total_kop) filter (where e.status = 'priced'), 0)::bigint,
           count(*) filter (where e.status = 'priced'),
           count(*) filter (where e.status = 'pending'),
           count(*) filter (where e.status = 'rejected')
    from work_entries e
    join shifts s on s.id = e.shift_id
    left join entry_money m on m.entry_id = e.id
    where s.work_date between p_from and p_to;
end $$;

-- ---------- Заявки ----------
create or replace function public.list_requests(q text default '', p_limit integer default 100)
returns table (id bigint, number text, requester text, registered_at date, subject text, state text, note text,
               entries bigint, last_work_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select r.id, r.number, r.requester, r.registered_at, r.subject, r.state, r.note,
           count(e.id), max(s.work_date)
    from requests r
    left join work_entries e on e.request_id = r.id
    left join shifts s on s.id = e.shift_id
    where public.search_words_match(public.normalize_search(r.number || ' ' || coalesce(r.requester, '') || ' ' || coalesce(r.subject, '')), q)
    group by r.id
    order by max(s.work_date) desc nulls last, r.created_at desc
    limit least(greatest(p_limit, 1), 300);
end $$;

create policy requests_insert on public.requests for insert to authenticated with check (public.is_manager());
create policy requests_update on public.requests for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
grant insert (number, requester, registered_at, subject, state, note) on public.requests to authenticated;
grant update (requester, registered_at, subject, state, note) on public.requests to authenticated;

-- ---------- Права на функции ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.require_manager()',
    'public.pending_queue()',
    'public.price_pending_entry(bigint, bigint, boolean)',
    'public.replace_entry_with_item(bigint, bigint, numeric)',
    'public.reject_entry(bigint, text)',
    'public.resubmit_entry(bigint, text, smallint, numeric, text, bigint)',
    'public.admin_entries(date, date, bigint, smallint, text, text, integer, integer)',
    'public.admin_update_entry(bigint, numeric, smallint, text, bigint[])',
    'public.admin_delete_entry(bigint)',
    'public.manager_dashboard()',
    'public.report_by_employee(date, date)',
    'public.report_by_month(date, date)',
    'public.report_totals(date, date)',
    'public.list_requests(text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
