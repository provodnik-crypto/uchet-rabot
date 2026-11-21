-- «Передать подрядчику» от мастера: просьба руководителю; руководитель передаёт или отклоняет.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заменить светильник');
select public.create_manual_request('Покрасить стену');
reset role;
create temp table _r on commit drop as select id, operation from public.requests where operation in ('Заменить светильник', 'Покрасить стену');
grant all on _r to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('misha');
select pg_temp.assert(pg_temp.err(format($q$select public.request_contractor(%s, 'Нужна вышка')$q$, (select id from _r where operation = 'Заменить светильник')))
  = 'Попросить можно только по своей заявке в работе', 'по чужой заявке просить нельзя');
reset role;

select pg_temp.login_as('kolya');
select public.take_request((select id from _r where operation = 'Заменить светильник'), null);
select pg_temp.assert(pg_temp.err(format($q$select public.request_contractor(%s, '')$q$, (select id from _r where operation = 'Заменить светильник')))
  = 'Напишите, почему нужен подрядчик', 'без причины нельзя');
select public.request_contractor((select id from _r where operation = 'Заменить светильник'), 'Нужна вышка 8 м');
select pg_temp.assert(pg_temp.err(format($q$select public.request_contractor(%s, 'Ещё раз')$q$, (select id from _r where operation = 'Заменить светильник')))
  = 'Просьба уже у руководителя — дождитесь ответа', 'вторую просьбу не отправить');
select pg_temp.assert((select status from public.requests where id = (select id from _r where operation = 'Заменить светильник')) = 'in_work', 'до решения заявка в работе');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert((public.list_master_reports() -> 0 ->> 'about_number') is not null, 'руководитель видит номер заявки');
reset role;
select pg_temp.assert(exists (select 1 from public.request_events where request_id = (select id from _r where operation = 'Заменить светильник')
  and kind = 'comment' and comment like 'Прошу передать подрядчику%'), 'просьба видна в сообщениях заявки');
select pg_temp.login_as('boss');
select public.decide_master_report((public.list_master_reports() -> 0 ->> 'id')::bigint, 'contractor');
select pg_temp.assert((select status from public.requests where id = (select id from _r where operation = 'Заменить светильник')) = 'contractor', 'передана подрядчику');
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert((public.my_master_reports() -> 0 ->> 'status') = 'contractor' and (public.my_master_reports() -> 0 ->> 'unseen')::boolean, 'мастер видит ответ');
-- отказ
select public.take_request((select id from _r where operation = 'Покрасить стену'), null);
select public.request_contractor((select id from _r where operation = 'Покрасить стену'), 'Нет краски нужного цвета');
reset role;
select pg_temp.login_as('boss');
select public.decide_master_report((public.list_master_reports() -> 0 ->> 'id')::bigint, 'reject', 'Краску привезут завтра');
select pg_temp.assert((select status from public.requests where id = (select id from _r where operation = 'Покрасить стену')) = 'in_work', 'отказ: заявка остаётся в работе');
reset role;
rollback;
