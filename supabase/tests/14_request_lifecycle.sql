-- Жизненный цикл заявки: взять, отказаться, отправить, принять, вернуть; приоритет; деньги после приёмки.
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where first_name = p_name or display_name = p_name $$;
create or replace function pg_temp.req(p_num text) returns bigint language sql as $$
  select id from public.requests where number = p_num $$;
create or replace function pg_temp.fails(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ПРОВАЛ: %', p_msg;
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  if sqlerrm not like p_like then raise exception 'ПРОВАЛ: % — другое сообщение: %', p_msg, sqlerrm; end if;
  raise notice 'ok: % (%)', p_msg, sqlerrm;
end $$;

begin;
select pg_temp.login_as('boss');
select public.request_import_apply($j${"rows": [
  {"number": "RFS261014_0001", "store_code": "031", "operation": "Ремонт стульев", "registered_at": "2026-10-14 08:00:00"},
  {"number": "RFS261014_0002", "store_code": "031", "operation": "Другие работы", "registered_at": "2026-10-14 09:00:00"},
  {"number": "RFS261014_0003", "store_code": "031", "operation": "Другие работы", "registered_at": "2026-10-14 10:00:00"}
], "file_rows": 3}$j$::jsonb);
select pg_temp.assert((select string_agg(status, ',') from public.requests where number like 'RFS261014_%') = 'waiting,waiting,waiting',
  'загруженные заявки — «Ожидает»');
select public.assign_request(pg_temp.req('RFS261014_0003'), pg_temp.emp('Михаил'), false);
select public.set_request_priority(pg_temp.req('RFS261014_0002'), 1::smallint);
reset role;

-- взять в работу: один берёт, второй получает понятный отказ
select pg_temp.login_as('kolya');
select public.take_request(pg_temp.req('RFS261014_0001'), 120, array[pg_temp.emp('Михаил')]);
select pg_temp.assert((select status || '/' || plan_minutes from public.requests where number = 'RFS261014_0001') = 'in_work/120',
  'взял: «В работе», примерное время стало планом');
select pg_temp.fails($q$select public.take_request(pg_temp.req('RFS261014_0003'), 60)$q$, '%назначена: Михаил М.%', 'назначенную другому не взять');
select pg_temp.assert((select string_agg(number, ',' order by 1) from public.open_requests('RFS261014', 'all') where priority = 1) = 'RFS261014_0002',
  'срочная видна с приоритетом');
select pg_temp.assert((select number from public.open_requests('RFS261014', 'all') limit 1) = 'RFS261014_0001', 'моя заявка — первой');
select pg_temp.assert((select number from public.open_requests('RFS261014', 'all') offset 1 limit 1) = 'RFS261014_0002', 'затем срочная');
reset role;

select pg_temp.login_as('misha');
select pg_temp.fails($q$select public.take_request(pg_temp.req('RFS261014_0001'), 60)$q$, '%уже взял Николай Х.%', 'второй мастер не возьмёт');
select pg_temp.assert((select responsible_name || '/' || member from public.open_requests('RFS261014_0001', 'all')) = 'Николай Х./true',
  'другой мастер видит «В работе · Николай Х.», напарник — свою отметку');
select pg_temp.assert(exists (select 1 from public.my_requests() where number = 'RFS261014_0001' and not responsible), 'у напарника заявка в «Мои заявки»');
select pg_temp.fails($q$select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(jsonb_build_object('request_number', 'RFS261014_0001', 'department_id', (select id from public.departments where is_default),
    'custom_name', 'Тест', 'unit_id', 1, 'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Михаил')))),
  'requests', '[]'::jsonb))$q$, '%взял Николай Х.%', 'работы по чужой заявке не внести, даже напарнику');
reset role;
select pg_temp.login_as('misha');
select public.take_request(pg_temp.req('RFS261014_0003'), 60);
select pg_temp.assert((select status from public.requests where number = 'RFS261014_0003') = 'in_work', 'назначенный берёт свою заявку');
reset role;

-- работы: цена есть, но в сумму — только после приёмки; деньги поровну
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(jsonb_build_object('request_number', 'RFS261014_0001', 'department_id', (select id from public.departments where is_default),
      'price_item_id', (select id from public.price_items where full_name = 'Благоустройство: Малые архитектурные формы: Установка скамеек'),
      'quantity', 2, 'performer_ids', jsonb_build_array(pg_temp.emp('Николай'), pg_temp.emp('Михаил')))),
  'requests', jsonb_build_array(jsonb_build_object('request_number', 'RFS261014_0001', 'minutes', 90))));
select pg_temp.assert((select total_kop || '/' || awaiting from public.my_month_summary()) = '0/1', 'до приёмки в сумме 0, работа ждёт приёмки');
select pg_temp.fails($q$select public.refuse_request(pg_temp.req('RFS261014_0001'), '')$q$, '%почему%', 'отказ без комментария нельзя');
select public.send_request_for_review(pg_temp.req('RFS261014_0001'), 'Готово');
select pg_temp.assert((select status from public.requests where number = 'RFS261014_0001') = 'review', 'отправлена: «На проверке»');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert(public.review_count() = 1, 'руководитель видит 1 на проверке');
select pg_temp.fails($q$select public.return_request(pg_temp.req('RFS261014_0001'), '')$q$, '%исправить%', 'вернуть без комментария нельзя');
select public.return_request(pg_temp.req('RFS261014_0001'), 'Сфотографируйте результат');
reset role;
select pg_temp.login_as('kolya');
select pg_temp.assert((select status || '/' || returned_comment from public.my_requests() where number = 'RFS261014_0001') = 'in_work/Сфотографируйте результат',
  'возвращена: снова «В работе» у того же мастера с комментарием');
select public.send_request_for_review(pg_temp.req('RFS261014_0001'));
reset role;
select pg_temp.login_as('boss');
select public.accept_request(pg_temp.req('RFS261014_0001'));
select pg_temp.assert((select string_agg(e ->> 'kind', ',' order by n) from jsonb_array_elements(public.request_card(pg_temp.req('RFS261014_0001')) -> 'events') with ordinality t(e, n))
  = 'accept,send,return,send,take', 'история смен статуса (сверху новые)');
reset role;
select pg_temp.login_as('kolya');
select pg_temp.assert((select total_kop from public.my_month_summary()) = 58800, 'после приёмки — доля поровну (1176 ₽ на двоих)');
select pg_temp.assert(not exists (select 1 from public.open_requests('RFS261014_0001', 'all')), 'принятая не в списке');
reset role;

-- отказ и снятие руководителем
select pg_temp.login_as('misha');
select public.refuse_request(pg_temp.req('RFS261014_0003'), 'Нет запчасти');
select pg_temp.assert((select status || '/' || coalesce(responsible_id::text, '-') from public.requests where number = 'RFS261014_0003') = 'waiting/-',
  'отказ: снова «Ожидает»');
reset role;
select pg_temp.login_as('boss');
select public.set_request_responsible(pg_temp.req('RFS261014_0003'), pg_temp.emp('Николай'));
select pg_temp.assert((select status || '/' || responsible_id from public.requests where number = 'RFS261014_0003') = 'in_work/' || pg_temp.emp('Николай'),
  'руководитель переназначил');
select public.set_request_responsible(pg_temp.req('RFS261014_0003'), null);
select pg_temp.assert((select status from public.requests where number = 'RFS261014_0003') = 'waiting', 'руководитель снял с мастера');
select public.assign_request(pg_temp.req('RFS261014_0003'), null, true);
reset role;
select pg_temp.login_as('kolya');
select pg_temp.fails($q$select public.take_request(pg_temp.req('RFS261014_0003'), 60)$q$, '%подрядчик%', 'заявку у подрядчика не взять');
select pg_temp.fails($q$select public.accept_request(pg_temp.req('RFS261014_0002'))$q$, '%руководител%', 'мастер не принимает');
reset role;
rollback;
