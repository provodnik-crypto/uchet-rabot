-- «Не могу выполнить»: нет материалов (сразу «Ждёт материалы», мастер свободен), заявка не нужна (закрывает руководитель),
-- нужен подрядчик (прежняя просьба).
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Покрасить дверь');
select public.create_manual_request('Повесить телевизор');
select public.create_manual_request('Заменить вывеску');
reset role;
create temp table _r on commit drop as select id, operation from public.requests where operation in ('Покрасить дверь', 'Повесить телевизор', 'Заменить вывеску');
grant all on _r to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('kolya');
select public.take_request((select id from _r where operation = 'Покрасить дверь'), null);
select pg_temp.assert(pg_temp.err(format($q$select public.cant_do(%s, 'materials', '')$q$, (select id from _r where operation = 'Покрасить дверь')))
  = 'Напишите, почему не можете выполнить', 'без комментария нельзя');
select pg_temp.assert(pg_temp.err(format($q$select public.cant_do(%s, 'materials', 'нет краски')$q$, (select id from _r where operation = 'Повесить телевизор')))
  = 'Можно только по своей заявке в работе', 'по чужой/не взятой нельзя');
select public.cant_do((select id from _r where operation = 'Покрасить дверь'), 'materials', 'Нет краски RAL 9016');
select pg_temp.assert((select status || '/' || hold_reason from public.requests where id = (select id from _r where operation = 'Покрасить дверь')) = 'paused/materials',
  'сразу «Ждёт материалы»');
-- мастер свободен: берёт другую
select public.take_request((select id from _r where operation = 'Повесить телевизор'), null);
select pg_temp.assert(pg_temp.err(format('select public.resume_request(%s)', (select id from _r where operation = 'Покрасить дверь'))) like 'У вас уже есть заявка в работе%',
  'продолжить, пока занят, нельзя');
-- заявка не нужна: просьба руководителю, заявка пока в работе
select public.cant_do((select id from _r where operation = 'Повесить телевизор'), 'not_needed', 'Телевизора нет, заявка старая');
select pg_temp.assert(pg_temp.err(format($q$select public.cant_do(%s, 'not_needed', 'ещё раз')$q$, (select id from _r where operation = 'Повесить телевизор')))
  = 'Просьба уже у руководителя — дождитесь ответа', 'вторую просьбу не отправить');
select pg_temp.assert((select status from public.requests where id = (select id from _r where operation = 'Повесить телевизор')) = 'in_work', 'до решения — в работе');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert((public.my_notifications() ->> 'materials')::int = 1, 'руководителю: ждут материалы — 1');
select pg_temp.assert((select count(*) from public.list_requests('', 100, 'all', 'materials')) = 1, 'фильтр «Ждут материалы»');
select pg_temp.assert((public.list_master_reports() -> 0 ->> 'kind') = 'close', 'просьба закрыть видна руководителю');
select public.decide_master_report((public.list_master_reports() -> 0 ->> 'id')::bigint, 'close', 'Согласен');
select pg_temp.assert((select not is_open from public.requests where id = (select id from _r where operation = 'Повесить телевизор')), 'закрыл руководитель');
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert((public.my_master_reports() -> 0 ->> 'status') = 'closed', 'мастер видит: закрыта');
-- освободился — продолжает заявку с материалами
select public.resume_request((select id from _r where operation = 'Покрасить дверь'));
select pg_temp.assert((select status from public.requests where id = (select id from _r where operation = 'Покрасить дверь')) = 'in_work', 'материалы пришли — снова в работе');
-- нужен подрядчик — прежняя просьба
select public.cant_do((select id from _r where operation = 'Покрасить дверь'), 'contractor', 'Нужна покрасочная камера');
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert((public.list_master_reports() -> 0 ->> 'kind') = 'contractor', 'подрядчик — та же просьба');
reset role;
rollback;
