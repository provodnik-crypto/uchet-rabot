-- Карточка заявки отдаёт client_uuid смены у работ и времени — телефон по нему подменяет правку дня черновиком.
begin;
create temp table _c (id bigint, num text, u uuid);
grant all on _c to authenticated;
select pg_temp.login_as('kolya');
insert into _c select (x ->> 'id')::bigint, x ->> 'number', gen_random_uuid() from public.start_planned_work('Прикрутить полку') x;
select public.submit_shift(jsonb_build_object('client_uuid', (select u from _c), 'work_date', public.app_today(),
  'entries', jsonb_build_array(jsonb_build_object('request_number', (select num from _c),
    'department_id', (select id from public.departments where is_default), 'custom_name', 'Монтаж полки', 'unit_id', 1,
    'quantity', 2, 'performer_ids', jsonb_build_array(public.current_employee_id()))),
  'requests', jsonb_build_array(jsonb_build_object('request_number', (select num from _c), 'minutes', 30))));
select pg_temp.assert((select public.request_card((select id from _c)) #>> '{works,0,shift_uuid}') = (select u::text from _c),
  'у работ есть shift_uuid');
select pg_temp.assert((select public.request_card((select id from _c)) #>> '{time_by_day,0,shift_uuid}') = (select u::text from _c),
  'у времени есть shift_uuid');
reset role;
rollback;
