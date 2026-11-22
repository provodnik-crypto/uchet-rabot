-- Главная МВСО + рейтинги: month_requests (принятые заявки месяца) и личный рейтинг мастера в report_by_employee.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
-- заявка принята в этом месяце: событие accept; мастер kolya получает оценку 5
insert into public.requests (number, subject, status) values ('RFS261122_4101', 'Шкаф для рейтинга', 'accepted');
insert into public.request_events (request_id, kind, from_status, to_status)
  select id, 'accept', 'review', 'accepted' from public.requests where number = 'RFS261122_4101';
insert into public.request_ratings (request_id, employee_id, score, comment)
  select r.id, (select id from public.employees where login = 'kolya'), 5, 'Быстро и чисто'
  from public.requests r where r.number = 'RFS261122_4101';

-- работа kolya сегодня (тесты 05/06 откатываются — иначе в отчёте нет строки с его рейтингом)
insert into public.shifts (work_date, author_id, client_uuid)
  values (public.app_today(), (select id from public.employees where login = 'kolya'), gen_random_uuid());
insert into public.work_entries (shift_id, position, department_id, price_item_id, unit_id, quantity, status)
  select s.id, 1, (select id from public.departments where is_default),
         (select id from public.price_items where full_name = 'Благоустройство: Малые архитектурные формы: Установка скамеек'),
         1, 1, 'priced'
  from public.shifts s
  where s.author_id = (select id from public.employees where login = 'kolya') and s.work_date = public.app_today()
  order by s.id desc limit 1;
insert into public.performer_money (entry_id, employee_id, share_kop)
  select e.id, (select id from public.employees where login = 'kolya'), 10000
  from public.work_entries e
  join public.shifts s on s.id = e.shift_id
  where s.author_id = (select id from public.employees where login = 'kolya') and s.work_date = public.app_today()
  order by e.id desc limit 1;

-- эталонные значения (считаем под postgres; клиенту таблицы закрыты)
create temp table _exp on commit drop as
  select (select count(distinct ev.request_id) from public.request_events ev
          where ev.kind = 'accept' and ev.created_at >= date_trunc('month', public.app_today())::date) as month_requests,
         (select round(avg(r.score)::numeric, 1) from public.request_ratings r
          where r.employee_id = (select id from public.employees where login = 'kolya')
            and r.created_at::date between public.app_today() and public.app_today()) as rating,
         (select count(*) from public.request_ratings r
          where r.employee_id = (select id from public.employees where login = 'kolya')
            and r.created_at::date between public.app_today() and public.app_today()) as rating_count,
         (select emp.id from public.employees emp
          where emp.role in ('master', 'service')
            and exists (select 1 from performer_money pm
                        join work_entries e on e.id = pm.entry_id and e.status = 'priced'
                        join shifts s on s.id = e.shift_id
                        where pm.employee_id = emp.id and s.work_date between public.app_today() and public.app_today())
            and not exists (select 1 from public.request_ratings r
                            where r.employee_id = emp.id
                              and r.created_at::date between public.app_today() and public.app_today())
          limit 1) as no_rate_id;
grant select on _exp to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('boss');
select pg_temp.assert((select month_requests from public.manager_dashboard()) = (select month_requests from _exp),
  'заявок за месяц = принятым заявкам месяца');
select pg_temp.assert((select rating from public.report_by_employee(public.app_today(), public.app_today())
  where employee_id = (select id from public.employees where login = 'kolya')) = (select rating from _exp),
  'личный рейтинг мастера = средней оценок за период');
select pg_temp.assert((select rating_count from public.report_by_employee(public.app_today(), public.app_today())
  where employee_id = (select id from public.employees where login = 'kolya')) = (select rating_count from _exp),
  'число оценок мастера за период');
select pg_temp.assert((select no_rate_id from _exp) is null
  or (select rating from public.report_by_employee(public.app_today(), public.app_today())
      where employee_id = (select no_rate_id from _exp)) is null,
  'мастер без оценок — рейтинг пустой');
select pg_temp.assert(pg_temp.err('select count(*) from public.report_by_employee(public.app_today(), public.app_today())')
  is null, 'руководителю список с рейтингами доступен');
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err('select count(*) from public.report_by_employee(public.app_today(), public.app_today())')
  like 'Доступно только МВСО%', 'мастеру список сотрудников недоступен');
reset role;
commit;
