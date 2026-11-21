-- ✏️ Исправление объёма и цены оценённой работы: только руководитель, пересчёт сумм, прайс не меняется, история.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка Правка');
reset role;
create temp table _r on commit drop as select id from public.requests where operation = 'Заявка Правка';
create temp table _p on commit drop as select pi.id, pi.unit_id from public.price_items pi where pi.is_active and not pi.is_material
  and public.price_on(pi.id, public.app_today()) > 0 order by pi.id limit 1;
alter table _p add column kop bigint;
update _p set kop = public.price_on(id, public.app_today());
grant all on _r, _p to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('kolya');
select public.take_request((select id from _r), null);
select public.add_request_work((select id from _r), jsonb_build_object('department_id', (select id from public.departments where is_default),
  'custom_name', 'Распил металла', 'unit_id', (select unit_id from _p),
  'quantity', 4, 'performer_ids', jsonb_build_array(public.current_employee_id())));
reset role;
create temp table _e on commit drop as select id from public.work_entries where request_id = (select id from _r);
grant all on _e to authenticated;

select pg_temp.login_as('boss');
select pg_temp.assert(pg_temp.err(format('select public.admin_correct_entry(%s, 5, 100000)', (select id from _e))) like '%нет цены%',
  'без цены исправлять нельзя — сначала оценка');
select public.price_pending_entry((select id from _e), 200000, false);
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err(format('select public.admin_correct_entry(%s, 5, 100000)', (select id from _e))) is not null,
  'мастер исправлять не может');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert(pg_temp.err(format('select public.admin_correct_entry(%s, 0, 100000)', (select id from _e))) is not null, 'объём 0 — нельзя');
select pg_temp.assert(pg_temp.err(format('select public.admin_correct_entry(%s, 4, 0)', (select id from _e))) is not null, 'цена 0 — нельзя');
select public.admin_correct_entry((select id from _e), 5, 150000);
reset role;
select pg_temp.assert((select quantity from public.work_entries where id = (select id from _e)) = 5, 'объём исправлен');
select pg_temp.assert((select unit_price_kop = 150000 and total_kop = 750000 from public.entry_money where entry_id = (select id from _e)),
  'цена и сумма работы пересчитаны: 5 × 1 500 = 7 500');
select pg_temp.assert((select sum(share_kop) from public.performer_money where entry_id = (select id from _e)) = 750000,
  'доли исполнителей пересчитаны');
select pg_temp.assert((select count(*) from public.entry_corrections where entry_id = (select id from _e)
  and old_quantity = 4 and new_quantity = 5 and old_unit_price_kop = 200000 and new_unit_price_kop = 150000) = 1, 'история записана');
select pg_temp.assert((select count(*) from public.request_events where request_id = (select id from _r) and comment like '%1 500%') = 0,
  'в ленте заявки (её видит мастер) о цене ничего нет');

select pg_temp.login_as('boss');
select pg_temp.assert((public.request_money((select id from _r)) -> 'works' -> 0 ->> 'corrected_at') is not null, 'руководитель видит «исправлено»');
select pg_temp.assert((public.request_money((select id from _r)) ->> 'total_kop')::bigint = 750000, 'итог заявки — новый');
-- для «шт» объём только целый (если позиция в штуках)
select pg_temp.assert(not (select integer_only from public.units where id = (select unit_id from _p))
  or pg_temp.err(format('select public.admin_correct_entry(%s, 2.5, 150000)', (select id from _e))) is not null, 'для «шт» — только целое');
-- принятая заявка: исправить можно
reset role;
update public.requests set status = 'review' where id = (select id from _r);
select pg_temp.login_as('boss');
select public.accept_request((select id from _r), null);
select public.admin_correct_entry((select id from _e), 5, 120000);
reset role;
select pg_temp.assert((select total_kop from public.entry_money where entry_id = (select id from _e)) = 600000, 'после «Принять» тоже исправляется');
select pg_temp.assert((select status from public.work_entries where id = (select id from _e)) = 'priced', 'работа осталась принятой');
select pg_temp.assert((select count(*) from public.price_item_prices pp join _p on pp.price_item_id = _p.id where pp.price_kop in (150000, 120000)) = 0,
  'прайс не изменился');
rollback;
