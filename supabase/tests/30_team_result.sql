-- Мастер не видит денег по людям: итог команды за месяц — три числа без строк по людям;
-- рейтинг, суммы по месяцам и своя сумма мастеру не отдаются; руководителю — всё как раньше.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.photo(p_n int) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid() || '/' || md5('t' || p_n)::uuid || '.jpg', 'thumb_path', auth.uid() || '/' || md5('t' || p_n)::uuid || '_t.jpg') $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка Итог');
select public.create_manual_request('Заявка Ждёт');
reset role;
create temp table _r on commit drop as select id, operation from public.requests where operation like 'Заявка %';
create temp table _p on commit drop as select pi.id from public.price_items pi where pi.is_active and not pi.is_material
  and public.price_on(pi.id, public.app_today()) > 0 order by pi.id limit 1;
grant all on _r, _p to authenticated;
create function pg_temp.rid(p text) returns bigint language sql as $$ select id from _r where operation = 'Заявка ' || p $$;
create function pg_temp.pwork(p_qty numeric) returns jsonb language sql as $$
  select jsonb_build_object('department_id', (select id from public.departments where is_default),
    'price_item_id', (select id from _p), 'quantity', p_qty, 'performer_ids', jsonb_build_array(public.current_employee_id())) $$;
grant execute on all functions in schema pg_temp to authenticated;

-- до этапа: что уже было принято в этом месяце (в чистой тестовой базе — ничего)
create temp table _before on commit drop as select * from public.team_result();
grant all on _before to authenticated;

-- Коля: заявка «Итог» — 2 работы, принята; Миша: заявка «Ждёт» — работа на проверке (в итог не идёт)
select pg_temp.login_as('kolya');
select public.take_request(pg_temp.rid('Итог'), null);
select public.add_request_work(pg_temp.rid('Итог'), pg_temp.pwork(2));
select public.add_request_work(pg_temp.rid('Итог'), pg_temp.pwork(1));
select public.send_request_for_review_photos(pg_temp.rid('Итог'), null, jsonb_build_array(pg_temp.photo(1)));
reset role;
select pg_temp.login_as('misha');
select public.take_request(pg_temp.rid('Ждёт'), null);
select public.add_request_work(pg_temp.rid('Ждёт'), pg_temp.pwork(5));
select public.send_request_for_review_photos(pg_temp.rid('Ждёт'), null, jsonb_build_array(pg_temp.photo(2)));
reset role;
select pg_temp.login_as('boss');
select public.accept_request(pg_temp.rid('Итог'), null);
reset role;

create temp table _sum on commit drop as
  select coalesce(sum(m.total_kop), 0)::bigint s from public.entry_money m join public.work_entries w on w.id = m.entry_id
  where w.request_id = (select id from _r where operation = 'Заявка Итог');
grant all on _sum to authenticated;

select pg_temp.login_as('misha');
select pg_temp.assert((select count(*) from public.team_result()) = 1, 'итог команды — одна строка, без строк по людям');
select pg_temp.assert((select total_kop - (select total_kop from _before) from public.team_result()) = (select s from _sum) and (select s from _sum) > 0,
  'сумма команды — только принятые работы');
select pg_temp.assert((select requests - (select requests from _before) from public.team_result()) = 1, 'заявок выполнено командой: +1');
select pg_temp.assert((select entries - (select entries from _before) from public.team_result()) = 2, 'работ командой: +2 (на проверке — не считаются)');
select pg_temp.assert((select month from public.team_result()) = date_trunc('month', public.app_today())::date, 'итог — за текущий месяц');
select pg_temp.assert((select count(*) from public.team_rating('2000-01-01', '2100-01-01')) = 0, 'мастеру рейтинг пустой');
select pg_temp.assert((select count(*) from public.team_by_month('2000-01-01', '2100-01-01')) = 0, 'мастеру суммы по месяцам пустые');
select pg_temp.assert((select total_kop from public.my_month_summary()) is null, 'своя сумма мастеру не отдаётся');
select pg_temp.assert((select count(*) from public.entry_money) = 0, 'суммы работ закрыты');
select pg_temp.assert((select count(*) from public.performer_money) = 0, 'суммы по сотрудникам закрыты');
select pg_temp.assert((select count(*) from public.price_item_prices) = 0, 'цены прайса закрыты');
select pg_temp.assert(pg_temp.err(format('select public.request_money(%s)', pg_temp.rid('Итог'))) is not null, 'цены работ заявки закрыты');
select pg_temp.assert(pg_temp.err('select * from public.report_by_employee(current_date, current_date)') is not null, 'сводка по сотрудникам закрыта');
select pg_temp.assert(pg_temp.err('select * from public.report_rows(current_date, current_date)') is not null, 'строки отчёта (Excel) закрыты');
select pg_temp.assert(pg_temp.err('select * from public.manager_dashboard()') is not null, 'сумма главной руководителя закрыта');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert((select count(*) from public.team_rating(public.app_today(), public.app_today()) where total_kop > 0) >= 1, 'руководитель видит рейтинг с суммами');
select pg_temp.assert((select count(*) from public.team_by_month(public.app_today(), public.app_today())) >= 1, 'руководитель видит суммы по месяцам');
select pg_temp.assert((select month_total_kop from public.manager_dashboard()) = (select total_kop from public.team_result()),
  'итог команды совпадает с суммой месяца у руководителя');
reset role;

set local role anon;
select pg_temp.assert(pg_temp.err('select * from public.team_result()') is not null, 'аноним итог команды не видит');
reset role;
rollback;
