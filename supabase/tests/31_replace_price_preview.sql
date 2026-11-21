-- «Заменить на прайс»: цена позиций на дату работы — только руководителю.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка Цена');
reset role;
create temp table _r on commit drop as select id from public.requests where operation = 'Заявка Цена';
create temp table _p on commit drop as select pi.id from public.price_items pi where pi.is_active and not pi.is_material
  and public.price_on(pi.id, public.app_today()) > 0 order by pi.id limit 1;
alter table _p add column kop bigint;
update _p set kop = public.price_on(id, public.app_today());
grant all on _r, _p to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('kolya');
select public.take_request((select id from _r), null);
select public.add_request_work((select id from _r), jsonb_build_object('department_id', (select id from public.departments where is_default),
  'custom_name', 'Замена фасадной плитки', 'unit_id', (select unit_id from public.price_items where id = (select id from _p)),
  'quantity', 4, 'performer_ids', jsonb_build_array(public.current_employee_id())));
reset role;
create temp table _e on commit drop as select id from public.work_entries where request_id = (select id from _r);
grant all on _e to authenticated;

select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err(format('select * from public.item_prices_for_entry(%s, array[%s]::bigint[])', (select id from _e), (select id from _p))) is not null,
  'мастеру цены позиций не отдаются');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert((select price_kop from public.item_prices_for_entry((select id from _e), array[(select id from _p)]))
  = (select kop from _p), 'руководитель видит цену позиции на дату работы');
select public.replace_entry_with_item((select id from _e), (select id from _p), null);
reset role;
select pg_temp.assert((select unit_price_kop from public.entry_money where entry_id = (select id from _e))
  = (select kop from _p), 'после замены цена та же, что показали');
rollback;
