-- Без учёта времени: смена без времени сохраняется, на проверку — только с работой, давность в рабочих днях.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Без времени');
reset role;
create temp table _r on commit drop as select id, number from public.requests where operation = 'Без времени';
grant select on _r to authenticated;
grant execute on all functions in schema pg_temp to authenticated;
create temp table _old on commit drop as select count(*) n, coalesce(sum(minutes), 0) m from public.shift_requests;

select pg_temp.login_as('kolya');
select public.take_request((select id from _r), null);
select pg_temp.assert(pg_temp.err(format('select public.send_request_for_review(%s)', (select id from _r))) = 'Добавьте хотя бы одну работу по заявке',
  'без работ на проверку не отправить');
-- смена как в новом приложении: только работы, без времени
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(jsonb_build_object('request_number', (select number from _r),
    'department_id', (select id from public.departments where is_default), 'custom_name', 'Осмотр', 'unit_id', 1, 'quantity', 1,
    'performer_ids', jsonb_build_array(public.current_employee_id())))));
select public.send_request_for_review((select id from _r));
reset role;
select pg_temp.assert((select status from public.requests where id = (select id from _r)) = 'review', 'смена без времени, заявка отправлена');
select pg_temp.assert((select count(*) from public.shift_requests sr where sr.request_id = (select id from _r)) = 0, 'новые записи времени не создаются');
select pg_temp.assert((select count(*) = (select n from _old) and coalesce(sum(minutes), 0) = (select m from _old) from public.shift_requests), 'старое время не тронуто');
rollback;
