-- Рейтинг команды: мастер видит итоги свои и коллег, но не цены и не суммы отдельных работ.
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where nickname = p_name or display_name = p_name $$;

begin;
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(
    jsonb_build_object('request_number', 'RFS261011_0001', 'department_id', (select id from public.departments where is_default),
      'price_item_id', (select id from public.price_items where full_name = 'Благоустройство: Малые архитектурные формы: Установка скамеек'),
      'quantity', 2, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'), pg_temp.emp('Миша'))),
    jsonb_build_object('request_number', 'RFS261011_0002', 'department_id', (select id from public.departments where is_default),
      'price_item_id', (select id from public.price_items where full_name = 'Благоустройство: Малые архитектурные формы: Установка скамеек'),
      'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'))),
    jsonb_build_object('department_id', (select id from public.departments where is_default),
      'custom_name', 'Распил МДФ', 'unit_id', 1, 'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'))))));
select pg_temp.assert((select total_kop from public.my_month_summary()) = 58800 + 58800, 'моя сумма за месяц: доля 588 + 588 ₽');
select pg_temp.assert((select requests from public.my_month_summary()) = 2, 'выполнено заявок: 2');
select pg_temp.assert((select pending from public.my_month_summary()) = 1, 'на оценке: 1, в сумму не входит');
select pg_temp.assert(
  (select string_agg(display_name || '=' || total_kop, ',' order by total_kop desc, display_name) from public.team_rating(public.app_today(), public.app_today()) where total_kop > 0)
  = 'Николай Х.=117600,Михаил М.=58800', 'мастер видит итоги свои и коллег');
select pg_temp.assert((select count(*) from public.team_rating(public.app_today(), public.app_today())) = 4, 'в рейтинге все 4 мастера, служебный «Не указан» — нет');
select pg_temp.assert((select sum(total_kop) from public.team_by_month(public.app_today(), public.app_today())) = 176400, 'разбивка по месяцам');
select pg_temp.assert((select count(*) from public.entry_money) = 0, 'суммы отдельных работ мастеру по-прежнему закрыты');
select pg_temp.assert((select count(*) from public.price_item_prices) = 0, 'цены прайса мастеру по-прежнему закрыты');
reset role;
set local role anon;
do $$ begin
  perform * from public.team_rating(current_date, current_date);
  raise exception 'ПРОВАЛ: аноним видит рейтинг';
exception when insufficient_privilege then raise notice 'ok: аноним рейтинг не видит';
end $$;
rollback;
