-- Данные Excel-отчёта: строки по исполнителям, суммы сходятся с итогами до копейки.
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where first_name = p_name or display_name = p_name $$;

begin;
select pg_temp.login_as('boss');
select public.admin_set_price((select id from public.price_items where full_name = 'Благоустройство: Малые архитектурные формы: Установка скамеек'), 2857);
reset role;
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(
    jsonb_build_object('department_id', (select id from public.departments where is_default),
      'price_item_id', (select id from public.price_items where full_name = 'Благоустройство: Малые архитектурные формы: Установка скамеек'),
      'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Николай'), pg_temp.emp('Михаил'), pg_temp.emp('Евгений'))),
    jsonb_build_object('department_id', (select id from public.departments where is_default),
      'custom_name', 'Распил МДФ', 'unit_id', 1, 'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Николай'))))));
do $$ begin
  perform * from public.report_rows(public.app_today(), public.app_today());
  raise exception 'ПРОВАЛ: мастер получил строки отчёта';
exception when insufficient_privilege then raise notice 'ok: данные отчёта только руководителю';
end $$;
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert((select count(*) from public.report_rows(public.app_today(), public.app_today())) = 3,
  'по строке на каждого исполнителя, работа на оценке не попадает');
select pg_temp.assert((select sum(share_kop) from public.report_rows(public.app_today(), public.app_today()))
  = (select total_kop from public.report_totals(public.app_today(), public.app_today())), 'сумма долей = итог до копейки');
select pg_temp.assert((select string_agg(share_kop::text, ',' order by performer_position) from public.report_rows(public.app_today(), public.app_today())) = '953,952,952',
  'доли с остатком первому');
select pg_temp.assert((select sum(total_kop) from public.report_by_work(public.app_today(), public.app_today())) = 2857, 'по видам работ');
select pg_temp.assert((select sum(total_kop) from public.report_month_employee(public.app_today(), public.app_today())) = 2857, 'месяцы по сотрудникам');
rollback;
