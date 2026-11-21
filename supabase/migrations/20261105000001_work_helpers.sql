-- Помощники по позициям работ (05.11.2026). Только добавляет; откат — supabase/rollback/20261105000001_work_helpers_down.sql
-- Деньги и раньше делились по каждой работе (entry_performers → performer_money, поровну между исполнителями работы),
-- поэтому таблицы не меняются и уже посчитанные заявки не пересчитываются.
--  * Основной исполнитель работы — автор её «дня» (shifts.author_id, мастер, у которого заявка в работе).
--    Помощники — остальные исполнители этой работы. Помощник заявку не берёт: правило «одна в работе» его не касается.
--  * set_work_helpers — помощники позиции: мастер — у своей работы, пока заявка у него «В работе»;
--    руководитель — у работы по заявке, пока заявка не принята. Доля — поровну между основным и помощниками.
--  * split_my_work — разделить строку: часть объёма уходит в новую строку того же вида без помощников.
--  * request_card.works[].main_id — основной исполнитель (чтобы не показывать его среди помощников).
--  * report_rows_v2 — как report_rows + helper (помощь по заявке) — для Excel.

create function public.set_work_helpers(p_entry bigint, p_helper_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  w work_entries;
  v_main bigint;
  v_status text;
  v_ids bigint[];
  v_emp bigint;
  n int;
  i int := 1;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select * into w from work_entries where id = p_entry for update;
  if not found then raise exception 'Работа не найдена'; end if;
  if w.request_id is null then raise exception 'Помощники указываются только у работ по заявке'; end if;
  if w.status = 'rejected' then raise exception 'Работа отклонена — сначала исправьте её'; end if;
  select status into v_status from requests where id = w.request_id for update;
  if public.is_manager() then
    if v_status = 'accepted' then raise exception 'Заявка уже принята — помощников не изменить'; end if;
  elsif (public.my_editable_entry(p_entry)).id is null then
    raise exception 'Помощников указывает мастер, у которого заявка «В работе»' using errcode = '42501';
  end if;
  select author_id into v_main from shifts where id = w.shift_id;

  select array_agg(x order by n0) into v_ids
  from (select x, min(n0) n0 from unnest(coalesce(p_helper_ids, '{}')) with ordinality t(x, n0) where x <> v_main group by x) t;
  if v_ids is not null and (select count(*) from employees where id = any (v_ids) and is_active and role = 'master') <> cardinality(v_ids) then
    raise exception 'Помощник не найден или отключён';
  end if;
  n := 1 + coalesce(cardinality(v_ids), 0);

  delete from entry_performers where entry_id = w.id;
  insert into entry_performers (entry_id, employee_id, position, share) values (w.id, v_main, 1, round(1.0 / n, 6));
  foreach v_emp in array coalesce(v_ids, '{}') loop
    i := i + 1;
    insert into entry_performers (entry_id, employee_id, position, share) values (w.id, v_emp, i, round(1.0 / n, 6));
  end loop;
  perform public.recompute_performer_money(w.id);
end $$;

/** Разделить строку: p_quantity уходит в новую строку того же вида (без помощников), в старой — остаток. Вернёт id новой. */
create function public.split_my_work(p_entry bigint, p_quantity numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  w work_entries;
  m entry_money;
  v_unit units;
  v_main bigint;
  v_new bigint;
begin
  if public.current_employee_id() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  w := public.my_editable_entry(p_entry);
  if w.id is null then raise exception 'Эту работу уже нельзя изменить'; end if;
  perform 1 from work_entries where id = w.id for update;
  select * into v_unit from units where id = w.unit_id;
  if p_quantity is null or p_quantity <= 0 or p_quantity >= w.quantity then
    raise exception 'Отделить можно часть объёма: больше нуля и меньше %', trim(to_char(w.quantity, 'FM999999990.###'));
  end if;
  if p_quantity <> round(p_quantity, 3) then raise exception 'Объём: не больше трёх знаков после запятой'; end if;
  if v_unit.integer_only and p_quantity <> trunc(p_quantity) then raise exception 'Для «%» объём должен быть целым числом', v_unit.code; end if;
  select author_id into v_main from shifts where id = w.shift_id;

  update work_entries set quantity = w.quantity - p_quantity where id = w.id;
  insert into work_entries (shift_id, position, request_id, department_id, price_item_id, custom_name, unit_id, quantity, note, status)
  values (w.shift_id, coalesce((select max(position) from work_entries where shift_id = w.shift_id), 0) + 1, w.request_id,
          w.department_id, w.price_item_id, w.custom_name, w.unit_id, p_quantity, w.note, w.status)
  returning id into v_new;
  insert into entry_performers (entry_id, employee_id, position, share) values (v_new, v_main, 1, 1);

  select * into m from entry_money where entry_id = w.id;
  if found then
    update entry_money set total_kop = round((w.quantity - p_quantity) * m.unit_price_kop)::bigint where entry_id = w.id;
    insert into entry_money (entry_id, unit_price_kop, total_kop, price_source, priced_by, priced_at)
    values (v_new, m.unit_price_kop, round(p_quantity * m.unit_price_kop)::bigint, m.price_source, m.priced_by, m.priced_at);
    perform public.recompute_performer_money(w.id);
    perform public.recompute_performer_money(v_new);
  end if;
  return v_new;
end $$;

-- карточка: основной исполнитель каждой работы
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.request_card(bigint,text)'::regprocedure);
  n := replace(d, $r$'shift_uuid', s.client_uuid, 'name', coalesce(p.short_name, w.custom_name),$r$,
               $r$'shift_uuid', s.client_uuid, 'main_id', s.author_id, 'name', coalesce(p.short_name, w.custom_name),$r$);
  if n = d then raise exception 'request_card: не нашёл место для main_id'; end if;
  execute n;
end $$;

/** Строки Excel: как report_rows + helper — исполнитель помогал по заявке (не основной). */
create function public.report_rows_v2(p_from date, p_to date)
returns table (work_date date, department_name text, request_number text, name text, unit_code text, quantity numeric,
               unit_price_kop bigint, entry_total_kop bigint, share_kop bigint, performer_count integer, performer_name text,
               note text, entry_id bigint, performer_position smallint, helper boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select s.work_date, d.name, r.number, coalesce(p.short_name, e.custom_name), u.code, e.quantity,
           m.unit_price_kop, m.total_kop, pm.share_kop,
           (select count(*)::int from entry_performers x where x.entry_id = e.id),
           emp.display_name, e.note, e.id, ep.position,
           (e.request_id is not null and ep.employee_id <> s.author_id)
    from work_entries e
    join shifts s on s.id = e.shift_id
    join entry_money m on m.entry_id = e.id
    join entry_performers ep on ep.entry_id = e.id
    join performer_money pm on pm.entry_id = e.id and pm.employee_id = ep.employee_id
    join employees emp on emp.id = ep.employee_id
    join departments d on d.id = e.department_id
    join units u on u.id = e.unit_id
    left join price_items p on p.id = e.price_item_id
    left join requests r on r.id = e.request_id
    where e.status = 'priced' and s.work_date between p_from and p_to
    order by s.work_date, s.id, e.position, ep.position;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.set_work_helpers(bigint, bigint[])', 'public.split_my_work(bigint, numeric)',
                           'public.report_rows_v2(date, date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
