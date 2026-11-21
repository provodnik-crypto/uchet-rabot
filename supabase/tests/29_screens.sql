-- Этап 3: «ждут приёмки» за период, счётчики заявок, фильтр долгих, строка заявки по id, название ручной заявки,
-- приоритет у принятой, мои открытые просьбы в карточке.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка Счёт');
reset role;
create temp table _r on commit drop as select id from public.requests where operation = 'Заявка Счёт';
create temp table _p on commit drop as select pi.id from public.price_items pi where pi.is_active and not pi.is_material
  and public.price_on(pi.id, public.app_today()) > 0 order by pi.id limit 1;
grant all on _r, _p to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('kolya');
select public.take_request((select id from _r), null);
select public.add_request_work((select id from _r), jsonb_build_object('department_id', (select id from public.departments where is_default),
  'price_item_id', (select id from _p), 'quantity', 2, 'performer_ids', jsonb_build_array(public.current_employee_id())));
select public.cant_do((select id from _r), 'not_needed', 'Сделали до нас');
select pg_temp.assert(public.request_card((select id from _r)) -> 'open_asks' = '["close"]'::jsonb, 'в карточке видна моя открытая просьба');
select pg_temp.assert(pg_temp.err('select public.awaiting_totals(current_date, current_date)') is not null, 'мастеру суммы «ждут приёмки» не отдаются');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert((public.awaiting_totals(public.app_today(), public.app_today()) ->> 'entries')::int = 1, '«ждут приёмки» — 1 работа');
select pg_temp.assert((public.request_counts() ->> 'in_work')::int >= 1, 'счётчик «в работе»');
select pg_temp.assert((select count(*) from public.request_row((select id from _r))) = 1, 'строка заявки по id');
select public.set_manual_request_title((select id from _r), 'Покрасить стену в коридоре');
select pg_temp.assert((select operation from public.requests where id = (select id from _r)) = 'Покрасить стену в коридоре', 'название ручной заявки поменялось');
select pg_temp.assert((select count(*) from public.list_requests('', 100, 'all', 'stale')) = 0, 'фильтр «долго в работе» — пока пусто');
select public.set_request_open((select id from _r), false);
select pg_temp.assert(pg_temp.err(format('select public.set_request_priority(%s, 1::smallint)', (select id from _r)))
  = 'У принятой или закрытой заявки приоритет не меняется', 'приоритет у закрытой не меняется');
reset role;
rollback;
