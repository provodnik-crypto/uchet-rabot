-- Ручные заявки: общая нумерация 1, 2, 3…; мастер — сразу «В работе», руководитель — «Ожидает» (можно назначить).
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where first_name = p_name or display_name = p_name $$;

begin;
create temp table _n (who text, num text);
grant all on _n to authenticated;

select pg_temp.login_as('boss');
insert into _n select 'boss', public.create_manual_request('Повесить зеркало', 'Примерочная, отдел 12') ->> 'number';
insert into _n select 'boss2', public.create_manual_request('Заменить лампу', null, pg_temp.emp('Михаил')) ->> 'number';
reset role;
select pg_temp.login_as('kolya');
insert into _n select 'kolya', public.create_manual_request('Подтянуть стеллаж') ->> 'number';
reset role;

select pg_temp.assert((select string_agg(num, ',' order by num::int) from _n) = '1,2,3', 'номера по порядку, общие для всех: 1, 2, 3');
select pg_temp.assert((select status || '/' || coalesce(assignee_id::text, '-') from public.requests where number = (select num from _n where who = 'boss')) = 'waiting/-',
  'руководитель создал — «Ожидает»');
select pg_temp.assert((select status || '/' || assignee_id from public.requests where number = (select num from _n where who = 'boss2')) = 'waiting/' || pg_temp.emp('Михаил'),
  'руководитель сразу назначил мастеру');
select pg_temp.assert((select status || '/' || responsible_id from public.requests where number = (select num from _n where who = 'kolya')) = 'in_work/' || pg_temp.emp('Николай'),
  'мастер создал — сразу «В работе» у него');

-- видна мастерам магазина, работы по номеру принимаются
select pg_temp.login_as('misha');
select pg_temp.assert(exists (select 1 from public.open_requests('', 'all') where number = (select num from _n where who = 'boss')), 'ручная заявка видна в списке мастера');
select pg_temp.assert((select mine from public.open_requests('', 'all') where number = (select num from _n where who = 'boss2')), 'назначенная — «Назначено вам»');
reset role;
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(jsonb_build_object('request_number', (select num from _n where who = 'kolya'),
    'department_id', (select id from public.departments where is_default), 'custom_name', 'Подтяжка креплений', 'unit_id', 1,
    'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Николай')))),
  'requests', jsonb_build_array(jsonb_build_object('request_number', (select num from _n where who = 'kolya'), 'minutes', 30))));
select pg_temp.assert(exists (select 1 from public.work_entries e join public.requests r on r.id = e.request_id where r.number = (select num from _n where who = 'kolya')),
  'работа по ручной заявке № сохранена');
do $$ begin
  perform public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
    'entries', jsonb_build_array(jsonb_build_object('request_number', '999', 'department_id', 1, 'custom_name', 'Тест', 'unit_id', 1,
      'quantity', 1, 'performer_ids', '[1]'::jsonb))));
  raise exception 'ПРОВАЛ: несуществующий простой номер';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: несуществующий простой номер не принимается';
end $$;
do $$ begin
  perform public.create_manual_request('Тест', null, 1);
  raise exception 'ПРОВАЛ: мастер назначил';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: назначать при создании может только руководитель';
end $$;
reset role;
rollback;
