-- NPS-сводка: функция только для МВСО; считает среднее и разбивку за месяц (включая прошлый).
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
-- инициатору сводка недоступна (оценки видит только МВСО)
select pg_temp.login_as('777123');
select pg_temp.assert(pg_temp.err('select public.manager_rating_summary()')
  like 'Нет доступа%', 'инициатору сводка недоступна');

-- мастеру тоже
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err('select public.manager_rating_summary()')
  like 'Нет доступа%', 'мастеру сводка недоступна');

-- МВСО видит сводку; данные этапа «Оценки» этого месяца учитываются
select pg_temp.login_as('boss');
select pg_temp.assert(pg_temp.err('select public.manager_rating_summary()') is null, 'МВСО получает сводку');
-- в текущем месяце есть оценка 4 и оценка 5 (занесены тестом 37; здесь добавим ещё для точности средних)
reset role;
insert into public.request_ratings (request_id, employee_id, score, comment)
select r.id, r.created_by, 5, null from public.requests r
where r.source = 'initiator' and r.status = 'accepted'
  and not exists (select 1 from public.request_ratings g where g.request_id = r.id)
  and date_trunc('month', r.registered_at) = date_trunc('month', now())
limit 1;
select pg_temp.assert(pg_temp.err('select public.manager_rating_summary()') is null, 'сводка после добавления оценки');
select pg_temp.assert((public.manager_rating_summary() ->> 'count')::int >= 2, 'сводка считает оценки месяца');
select pg_temp.assert((public.manager_rating_summary() ->> 'fives')::int >= 1, 'разбивка по пятёркам');
select pg_temp.assert((public.manager_rating_summary() ->> 'avg') is not null, 'среднее за месяц посчитано');
reset role;
commit;
