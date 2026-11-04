-- Помощники по позициям: доля поровну внутри позиции, остальное — основному; разделение строки; Excel; итог команды.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.photo(p_n int) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid() || '/' || md5('h' || p_n)::uuid || '.jpg', 'thumb_path', auth.uid() || '/' || md5('h' || p_n)::uuid || '_t.jpg') $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка Помощь');
select public.create_manual_request('Заявка Миши');
reset role;
create temp table _r on commit drop as select id, operation from public.requests where operation like 'Заявка %';
create temp table _p on commit drop as select pi.id, public.price_on(pi.id, public.app_today()) price from public.price_items pi
  join public.units u on u.id = pi.unit_id
  where pi.is_active and not pi.is_material and not u.integer_only and public.price_on(pi.id, public.app_today()) > 0 order by pi.id limit 1;
create temp table _w (n int, id bigint) on commit drop;
grant all on _r, _p, _w to authenticated;
create function pg_temp.rid(p text) returns bigint language sql as $$ select id from _r where operation = 'Заявка ' || p $$;
create function pg_temp.emp(p text) returns bigint language sql as $$ select id from public.employees where login = p $$;
create function pg_temp.wid(p int) returns bigint language sql as $$ select id from _w where n = p $$;
create or replace function pg_temp.pwork(p_qty numeric) returns jsonb language sql as $$
  select jsonb_build_object('department_id', (select id from public.departments where is_default), 'price_item_id', (select id from _p),
    'quantity', p_qty, 'performer_ids', jsonb_build_array(public.current_employee_id())) $$;
create function pg_temp.money(p_entry bigint, p_login text) returns bigint language sql as $$
  select share_kop from public.performer_money where entry_id = p_entry and employee_id = pg_temp.emp(p_login) $$;
grant execute on all functions in schema pg_temp to authenticated;

-- снимок денег старых работ (до этапа) — не должен измениться
create temp table _old on commit drop as select entry_id, employee_id, share_kop from public.performer_money;

-- помощник сам занят своей заявкой — помогать это не мешает
select pg_temp.login_as('misha');
select public.take_request(pg_temp.rid('Миши'), null);
reset role;

select pg_temp.login_as('kolya');
select public.take_request(pg_temp.rid('Помощь'), null);
insert into _w select 1, public.add_request_work(pg_temp.rid('Помощь'), pg_temp.pwork(2));
insert into _w select 2, public.add_request_work(pg_temp.rid('Помощь'), pg_temp.pwork(3));
insert into _w select 3, public.add_request_work(pg_temp.rid('Помощь'), pg_temp.pwork(15));
select pg_temp.assert(pg_temp.err(format('select public.set_work_helpers(%s, array[%s])', pg_temp.wid(1), pg_temp.emp('boss'))) is not null,
  'помощник — только мастер');
select public.set_work_helpers(pg_temp.wid(1), array[pg_temp.emp('misha'), pg_temp.emp('kolya')]);
select pg_temp.assert((public.request_card(pg_temp.rid('Помощь')) -> 'works' -> 0 ->> 'main_id')::bigint = pg_temp.emp('kolya'), 'в карточке виден основной исполнитель');
select pg_temp.assert(public.request_card(pg_temp.rid('Помощь'))::text not like '%share_kop%' and public.request_card(pg_temp.rid('Помощь'))::text not like '%total_kop%',
  'мастер сумм не получает');
-- разделить строку: 15 → 10 с помощником + 5 сам
create temp table _s on commit drop as select public.split_my_work(pg_temp.wid(3), 5) id;
grant select on _s to authenticated;
select public.set_work_helpers(pg_temp.wid(3), array[pg_temp.emp('misha')]);
select pg_temp.assert(pg_temp.err(format('select public.split_my_work(%s, 10)', pg_temp.wid(3))) is not null, 'отделить весь объём нельзя');
select public.send_request_for_review_photos(pg_temp.rid('Помощь'), null, jsonb_build_array(pg_temp.photo(1)));
select pg_temp.assert(pg_temp.err(format('select public.set_work_helpers(%s, null)', pg_temp.wid(1))) is not null, 'после отправки мастер помощников не меняет');
reset role;

select pg_temp.assert((select employee_id from public.entry_performers where entry_id = pg_temp.wid(1) and position = 1) = pg_temp.emp('kolya')
                      and (select count(*) from public.entry_performers where entry_id = pg_temp.wid(1)) = 2, 'основной не дублируется среди помощников');
select pg_temp.assert(pg_temp.money(pg_temp.wid(1), 'kolya') + pg_temp.money(pg_temp.wid(1), 'misha') = 2 * (select price from _p)
                      and abs(pg_temp.money(pg_temp.wid(1), 'kolya') - pg_temp.money(pg_temp.wid(1), 'misha')) <= 1, 'позиция с помощником — 50/50');
select pg_temp.assert(pg_temp.money(pg_temp.wid(2), 'kolya') = 3 * (select price from _p) and pg_temp.money(pg_temp.wid(2), 'misha') is null,
  'позиция без помощника — целиком основному');
select pg_temp.assert((select quantity from public.work_entries where id = pg_temp.wid(3)) = 10 and (select quantity from public.work_entries where id = (select id from _s)) = 5,
  'строка разделена: 10 + 5');
select pg_temp.assert(pg_temp.money((select id from _s), 'kolya') = round(5 * (select price from _p)) and pg_temp.money((select id from _s), 'misha') is null,
  'отделённая часть — без помощника');
select pg_temp.assert(pg_temp.money(pg_temp.wid(3), 'misha') + pg_temp.money(pg_temp.wid(3), 'kolya') = round(10 * (select price from _p)), '10 с помощником делятся');

-- руководитель на проверке исправляет помощников
select pg_temp.login_as('boss');
select public.set_work_helpers(pg_temp.wid(2), array[pg_temp.emp('misha')]);
select public.set_work_helpers(pg_temp.wid(2), '{}');
select public.accept_request(pg_temp.rid('Помощь'), null);
select pg_temp.assert(pg_temp.err(format('select public.set_work_helpers(%s, null)', pg_temp.wid(1))) is not null, 'после «Принять» — не меняется');
select pg_temp.assert((select count(*) from public.report_rows_v2(public.app_today(), public.app_today())
                       where helper and performer_name = (select display_name from public.employees where login = 'misha') and request_number is not null) = 2,
  'Excel: у помощника 2 строки с номером заявки и пометкой помощи');
select pg_temp.assert((select sum(share_kop) from public.report_rows_v2(public.app_today(), public.app_today()) where entry_id in (select id from _w union select id from _s))
                      = (select sum(total_kop) from public.entry_money where entry_id in (select id from _w union select id from _s)), 'сумма долей = стоимости работ');
reset role;
create temp table _team on commit drop as select coalesce(sum(m.total_kop), 0) total from public.work_entries w
  join public.shifts s on s.id = w.shift_id join public.employees a on a.id = s.author_id join public.entry_money m on m.entry_id = w.id
  where w.status = 'priced' and s.work_date >= date_trunc('month', public.app_today())::date
    and coalesce(a.store_id, public.default_store_id()) = (select coalesce(store_id, public.default_store_id()) from public.employees where login = 'kolya');
grant select on _team to authenticated;
select pg_temp.login_as('kolya');
select pg_temp.assert((select total_kop from public.team_result()) = (select total from _team), 'итог команды — по стоимости работ, от распределения не зависит');
reset role;
select pg_temp.assert(not exists (select 1 from _old o left join public.performer_money pm using (entry_id, employee_id) where pm.share_kop is distinct from o.share_kop),
  'старые работы посчитаны как раньше');
rollback;
