-- Исправить и удалить сообщение: своё — да, чужое — только руководитель удаляет; удалённое не в непрочитанных.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка для переписки');
reset role;
create temp table _r on commit drop as select id from public.requests where operation = 'Заявка для переписки';
grant select on _r to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('kolya');
select public.add_request_comment((select id from _r), 'Нужна стремянка');
select public.add_request_comment((select id from _r), 'И ключ от щитовой');
reset role;
create temp table _e on commit drop as
  select id, comment from public.request_events where request_id = (select id from _r) and kind = 'comment' order by id;
grant select on _e to authenticated;

select pg_temp.login_as('kolya');
select public.edit_request_comment((select min(id) from _e), 'Нужна стремянка 3 м');
select pg_temp.assert((select ev ->> 'comment' || ' ' || (ev ->> 'edited') from jsonb_array_elements(public.request_card((select id from _r)) -> 'events') ev
  where (ev ->> 'id')::bigint = (select min(id) from _e)) = 'Нужна стремянка 3 м true', 'своё исправлено, помечено «изменено»');
reset role;

select pg_temp.login_as('misha');
select pg_temp.assert(pg_temp.err(format('select public.edit_request_comment(%s, %L)', (select min(id) from _e), 'чужое')) = 'Исправить можно только своё сообщение', 'чужое не исправить');
select pg_temp.assert(pg_temp.err(format('select public.delete_request_comment(%s)', (select min(id) from _e))) = 'Удалить чужое сообщение может только руководитель', 'чужое мастер не удалит');
reset role;

select pg_temp.assert(public.request_unread((select id from _r), (select id from public.employees where login = 'boss'), true) = 2, 'у руководителя 2 непрочитанных');
select pg_temp.login_as('boss');
select public.delete_request_comment((select max(id) from _e));
reset role;
select pg_temp.assert(public.request_unread((select id from _r), (select id from public.employees where login = 'boss'), true) = 1, 'удалённое не считается непрочитанным');
select pg_temp.login_as('boss');
select pg_temp.assert((select (ev ->> 'deleted')::boolean and ev ->> 'comment' is null from jsonb_array_elements(public.request_card((select id from _r)) -> 'events') ev
  where (ev ->> 'id')::bigint = (select max(id) from _e)), 'руководитель удалил чужое: в ленте «удалено», текста нет');
reset role;

select pg_temp.login_as('kolya');
select public.delete_request_comment((select min(id) from _e));
select pg_temp.assert(pg_temp.err(format('select public.edit_request_comment(%s, %L)', (select min(id) from _e), 'ещё')) = 'Сообщение не найдено', 'удалённое не исправить');
reset role;
rollback;
