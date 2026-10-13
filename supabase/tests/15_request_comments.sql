-- Переписка по заявке, непрочитанные, уведомления на главной, дни без действий.
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where first_name = p_name or display_name = p_name $$;
create or replace function pg_temp.req(p_num text) returns bigint language sql as $$
  select id from public.requests where number = p_num $$;

begin;
select pg_temp.login_as('boss');
select public.request_import_apply($j${"rows": [
  {"number": "RFS261015_0001", "store_code": "031", "operation": "Ремонт стульев", "registered_at": "2026-10-14 08:00:00"},
  {"number": "RFS261015_0002", "store_code": "031", "operation": "Другие работы", "registered_at": "2026-10-14 09:00:00"}
], "file_rows": 2}$j$::jsonb);
reset role;

select pg_temp.login_as('kolya');
select public.take_request(pg_temp.req('RFS261015_0001'), 60);
select public.add_request_comment(pg_temp.req('RFS261015_0001'), 'Нужна стремянка');
select pg_temp.assert((select unread from public.open_requests('RFS261015_0001', 'all')) = 0, 'своё сообщение не считается непрочитанным');
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert((select unread from public.list_requests('RFS261015_0001')) = 1, 'руководитель видит новое сообщение');
select pg_temp.assert(public.my_notifications() -> 'unread' @> jsonb_build_array(jsonb_build_object('number', 'RFS261015_0001', 'count', 1)),
  'уведомление руководителю на главной');
select public.mark_request_read(pg_temp.req('RFS261015_0001'));
select pg_temp.assert((select unread from public.list_requests('RFS261015_0001')) = 0, 'открыл карточку — прочитано');
select public.add_request_comment(pg_temp.req('RFS261015_0001'), 'Стремянка на складе, ряд 3');
select public.set_request_priority(pg_temp.req('RFS261015_0002'), 1::smallint);
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert((select unread from public.my_requests() where number = 'RFS261015_0001') = 1, 'мастер видит ответ руководителя');
select pg_temp.assert(public.my_notifications() -> 'unread' @> '[{"number": "RFS261015_0001", "count": 1}]', 'уведомление мастеру');
select pg_temp.assert(public.my_notifications() -> 'urgent' @> '[{"number": "RFS261015_0002"}]', 'срочная заявка — в уведомлениях мастера');
select pg_temp.assert((select string_agg(e ->> 'kind' || ':' || (e ->> 'mine'), ',' order by n)
                       from jsonb_array_elements(public.request_card(pg_temp.req('RFS261015_0001')) -> 'events') with ordinality t(e, n))
  = 'comment:false,comment:true,take:true', 'в ленте сообщения и события, видно свои');
select public.mark_request_read(pg_temp.req('RFS261015_0001'));
select pg_temp.assert(public.my_notifications() -> 'unread' = '[]', 'прочитал — уведомление ушло');
do $$ begin
  perform public.add_request_comment((select id from public.requests where number = 'RFS261015_0001'), '   ');
  raise exception 'ПРОВАЛ: пустое сообщение';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: пустое сообщение не отправить';
end $$;
do $$ begin
  perform public.request_unread(1, 1, true);
  raise exception 'ПРОВАЛ: счётчик доступен напрямую';
exception when insufficient_privilege then raise notice 'ok: чужие отметки «прочитано» не видны';
end $$;
reset role;

-- без действий 3+ рабочих дня
update public.requests set last_activity_at = now() - interval '10 days' where number = 'RFS261015_0001';
select pg_temp.login_as('boss');
select pg_temp.assert((select stale_days from public.list_requests('RFS261015_0001')) >= 4, 'дни без действий считаются по рабочим дням');
select pg_temp.assert((public.my_notifications() ->> 'stale')::int >= 1, 'руководитель видит зависшие заявки');
reset role;
rollback;
