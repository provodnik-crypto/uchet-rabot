-- Руководитель: оценка работ вне прайса, отклонение и исправление, журнал, сводки, заявки.
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where first_name = p_name or display_name = p_name $$;
create or replace function pg_temp.dep() returns smallint language sql as $$
  select id from public.departments where is_default $$;
create or replace function pg_temp.custom(p_name text, p_qty numeric, p_unit text, variadic p_perf text[]) returns jsonb language sql as $$
  select jsonb_build_object('department_id', pg_temp.dep(), 'custom_name', p_name,
    'unit_id', (select id from public.units where code = p_unit), 'quantity', p_qty,
    'performer_ids', (select jsonb_agg(pg_temp.emp(x)) from unnest(p_perf) x)) $$;

begin;
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(
    pg_temp.custom('Распил МДФ', 3, 'шт', 'Николай', 'Михаил'),
    pg_temp.custom('Сборка мебели для подиума', 1, 'шт', 'Николай'),
    pg_temp.custom('Монтаж плаката', 2, 'шт', 'Николай'),
    pg_temp.custom('Что-то непонятное', 1, 'шт', 'Николай'))));
do $$ begin
  perform * from public.pending_queue();
  raise exception 'ПРОВАЛ: мастер открыл очередь';
exception when insufficient_privilege then raise notice 'ok: очередь «На оценке» только руководителю';
end $$;
do $$ begin
  perform * from public.report_by_employee(public.app_today() - 30, public.app_today());
  raise exception 'ПРОВАЛ: мастер открыл сводку';
exception when insufficient_privilege then raise notice 'ok: сводка только руководителю';
end $$;

reset role;
select pg_temp.login_as('boss');
select pg_temp.assert((select pending_count from public.manager_dashboard()) = 4, 'на главной руководителя счётчик «На оценке» = 4');
select pg_temp.assert((select count(*) from public.pending_queue()) = 4, 'в очереди 4 работы');
select pg_temp.assert((select total_kop from public.report_totals(public.app_today(), public.app_today())) = 0, 'неоценённые работы не попадают в суммы');
select pg_temp.assert((select pending from public.report_totals(public.app_today(), public.app_today())) = 4, 'число работ без цены видно отдельно');

-- назначить цену 333,33 ₽ за шт × 3, на двоих, и добавить в прайс
select public.price_pending_entry((select entry_id from public.pending_queue() where custom_name = 'Распил МДФ'), 33333, true);
select pg_temp.assert(
  (select m.total_kop from public.entry_money m join public.work_entries e on e.id = m.entry_id where e.custom_name = 'Распил МДФ') = 99999,
  'цена назначена: 3 × 333,33 = 999,99 ₽');
select pg_temp.assert(
  (select string_agg(pm.share_kop::text, ',' order by ep.position) from public.performer_money pm
   join public.entry_performers ep using (entry_id, employee_id)
   join public.work_entries e on e.id = pm.entry_id where e.custom_name = 'Распил МДФ') = '50000,49999',
  'доли 500,00 + 499,99, копейка первому');
select pg_temp.assert(
  (select category from public.price_items where full_name = 'Распил МДФ') = 'Добавлено вручную', 'работа добавлена в прайс');
select pg_temp.assert(
  (select price_kop from public.admin_price_items('распил мдф', 'all') where full_name = 'Распил МДФ') = 33333, 'в прайсе та же цена');

-- заменить на позицию прайса (единица совпадает — объём прежний)
select public.replace_entry_with_item(
  (select entry_id from public.pending_queue() where custom_name = 'Сборка мебели для подиума'),
  (select id from public.price_items where full_name = 'Благоустройство: Малые архитектурные формы: Установка скамеек'));
select pg_temp.assert(
  (select m.total_kop from public.entry_money m join public.work_entries e on e.id = m.entry_id
   join public.price_items p on p.id = e.price_item_id where p.short_name = 'Установка скамеек') = 58800,
  'замена на позицию прайса подставила цену прайса');

-- отклонить
do $$ begin
  perform public.reject_entry((select entry_id from public.pending_queue() where custom_name = 'Что-то непонятное'), '');
  raise exception 'ПРОВАЛ: отклонение без комментария';
exception when raise_exception then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: отклонить можно только с комментарием';
end $$;
select public.reject_entry((select entry_id from public.pending_queue() where custom_name = 'Что-то непонятное'), 'Уточните, что за работа');
select pg_temp.assert((select count(*) from public.pending_queue()) = 1, 'в очереди осталась одна работа');

-- подсказка прошлой цены для такой же работы
reset role;
select pg_temp.login_as('misha');
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.custom('распил  мдф', 2, 'шт', 'Михаил'))));
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert(
  (select hint_price_kop from public.pending_queue() where custom_name = 'распил  мдф') = 33333,
  'для уже оценённой работы подставляется прошлая цена');

-- мастер видит статус и комментарий, исправляет и отправляет снова
reset role;
select pg_temp.login_as('kolya');
select pg_temp.assert(
  (select reject_comment from public.my_entries() where status = 'rejected') = 'Уточните, что за работа', 'мастер видит комментарий');
select pg_temp.assert(
  (select count(*) from public.my_entries() where status = 'priced') = 2 and
  not exists (select 1 from public.my_entries() where can_edit), 'обработанную смену мастер уже не правит целиком');
select public.resubmit_entry((select entry_id from public.my_entries() where status = 'rejected'),
  'Монтаж полки в подсобке', (select id from public.units where code = 'шт'), 1, 'исправил');
select pg_temp.assert(
  (select status from public.my_entries() where name = 'Монтаж полки в подсобке') = 'pending', 'исправленная работа снова на оценке');
reset role;
select pg_temp.login_as('misha');
do $$ begin
  perform public.resubmit_entry((select id from public.work_entries where custom_name = 'Монтаж полки в подсобке'), 'Взлом', 1::smallint, 1, null);
  raise exception 'ПРОВАЛ: чужая работа исправлена';
exception when insufficient_privilege then raise notice 'ok: исправить можно только свою работу';
end $$;

-- сводки
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert(
  (select total_kop from public.report_totals(public.app_today(), public.app_today())) = 99999 + 58800, 'общий итог: полная сумма один раз');
select pg_temp.assert(
  (select sum(total_kop) from public.report_by_employee(public.app_today(), public.app_today())) = 99999 + 58800,
  'сумма долей сотрудников равна общему итогу');
select pg_temp.assert(
  (select total_kop from public.report_by_employee(public.app_today(), public.app_today()) where display_name = 'Николай Х.') = 50000 + 58800,
  'выработка Коли: его доля + целая работа');
select pg_temp.assert(
  (select shifts from public.report_by_employee(public.app_today(), public.app_today()) where display_name = 'Николай Х.') = 1, 'число смен');
select pg_temp.assert(
  (select total_kop from public.report_by_month(date_trunc('month', public.app_today())::date, public.app_today())) = 99999 + 58800,
  'сумма по месяцу');
select pg_temp.assert(
  (select max(total_rows) from public.admin_entries(public.app_today(), public.app_today())) = 5, 'журнал: все работы за день');
select pg_temp.assert(
  (select max(total_rows) from public.admin_entries(public.app_today(), public.app_today(), pg_temp.emp('Михаил'))) = 2,
  'журнал: фильтр по сотруднику');
select pg_temp.assert(
  (select max(total_rows) from public.admin_entries(public.app_today(), public.app_today(), null, null, null, 'pending')) = 3,
  'журнал: фильтр по статусу');

-- правка руководителем: объём и исполнители, цена за единицу та же
select public.admin_update_entry(
  (select e.id from public.work_entries e where e.custom_name = 'Распил МДФ'), 4, pg_temp.dep(), null,
  array[pg_temp.emp('Михаил'), pg_temp.emp('Евгений'), pg_temp.emp('Николай')]);
select pg_temp.assert(
  (select m.total_kop from public.entry_money m join public.work_entries e on e.id = m.entry_id where e.custom_name = 'Распил МДФ') = 133332,
  'правка объёма пересчитала сумму по прежней цене');
select pg_temp.assert(
  (select sum(pm.share_kop) from public.performer_money pm join public.work_entries e on e.id = pm.entry_id where e.custom_name = 'Распил МДФ') = 133332,
  'доли после правки равны сумме');
select public.admin_delete_entry((select e.id from public.work_entries e where e.custom_name = 'Распил МДФ'));
select pg_temp.assert(not exists (select 1 from public.work_entries where custom_name = 'Распил МДФ'), 'руководитель удаляет запись');

-- заявки
insert into public.requests (number, subject) values ('INC251125_3012', 'Замена светильников');
update public.requests set subject = 'Замена смесителя' where number = 'INC251125_3012';
select pg_temp.assert((select subject from public.list_requests('смесител')) = 'Замена смесителя', 'руководитель ведёт заявки и ищет по ним');
rollback;
