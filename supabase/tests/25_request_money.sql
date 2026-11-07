-- Цены и суммы работ заявки: руководителю — да, мастеру — нет.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Повесить полки');
reset role;
create temp table _r on commit drop as select id from public.requests where operation = 'Повесить полки';
create temp table _p on commit drop as
  select pi.id, pp.price_kop from public.price_items pi
  join lateral (select price_kop from public.price_item_prices x where x.price_item_id = pi.id and x.valid_from <= current_date order by valid_from desc limit 1) pp on true
  where pp.price_kop > 0 and pi.is_active and not pi.is_material order by pi.id limit 1;
grant all on _r, _p to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('kolya');
select public.take_request((select id from _r), null);
select public.add_request_work((select id from _r), jsonb_build_object('department_id', (select id from public.departments where is_default),
  'price_item_id', (select id from _p), 'quantity', 3, 'performer_ids', jsonb_build_array(public.current_employee_id())));
select public.add_request_work((select id from _r), jsonb_build_object('department_id', (select id from public.departments where is_default),
  'custom_name', 'Подрезать полку', 'unit_id', 1, 'quantity', 1, 'performer_ids', jsonb_build_array(public.current_employee_id())));
select pg_temp.assert(pg_temp.err(format('select public.request_money(%s)', (select id from _r))) is not null, 'мастер цены заявки не получает');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert((public.request_money((select id from _r)) ->> 'total_kop')::bigint = (select price_kop * 3 from _p), 'итог = цена × количество');
select pg_temp.assert((public.request_money((select id from _r)) ->> 'unpriced')::int = 1, 'работа вне прайса — без цены');
select pg_temp.assert((select count(*) from jsonb_array_elements(public.request_money((select id from _r)) -> 'works') x
  where (x ->> 'unit_price_kop')::bigint = (select price_kop from _p)) = 1, 'цена за единицу по работе');
reset role;
rollback;
