-- Причина закрытия (23.11.2026): МВСО не может закрыть вручную заявку не «Принята» без причины;
-- причина пишется в ленту (kind 'close'); инициатор видит закрытую как 'closed' («Закрыта»)
-- с причиной в карточке; повторное открытие работает; «Принятая» закрывается без причины.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.photo(p_n int) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid() || '/' || md5('h' || p_n)::uuid || '.jpg',
                            'thumb_path', auth.uid() || '/' || md5('h' || p_n)::uuid || '_t.jpg') $$;

begin;

-- ---------- Обычная заявка «Ожидает»: без причины не закрыть ----------
insert into public.requests (number, source, store_id, operation, subject, registered_at, status, priority, created_by)
values ('MANUAL_42_1', 'manual', public.default_store_id(), 'Ремонт', 'Тест 42: закрытие без причины',
        (now() at time zone public.app_timezone()), 'waiting', 3,
        (select id from public.employees where login = 'boss'))
on conflict (number) do nothing;
create temp view _r42 as select id, number, status, is_open from public.requests
  where number in ('MANUAL_42_1', 'MANUAL_42_2');

select pg_temp.login_as('boss');
select pg_temp.assert(pg_temp.err('select public.set_request_open((select id from _r42 where number = ''MANUAL_42_1''), false)')
  like '%причин%', 'закрытие без причины запрещено');
select pg_temp.assert(pg_temp.err('select public.set_request_open((select id from _r42 where number = ''MANUAL_42_1''), false, ''   '')')
  like '%причин%', 'пустая причина не подходит');
select pg_temp.assert(pg_temp.err('select public.set_request_open((select id from _r42 where number = ''MANUAL_42_1''), false, ''Товар убрали из магазина'')')
  is null, 'с причиной закрывается');
select pg_temp.assert((select is_open from _r42 where number = 'MANUAL_42_1') = false, 'заявка закрыта');
select pg_temp.assert(exists (select 1 from public.request_events e
  where e.request_id = (select id from _r42 where number = 'MANUAL_42_1')
    and e.kind = 'close' and e.comment = 'Товар убрали из магазина'), 'причина в ленте (kind close)');
-- повторное открытие
select pg_temp.assert(pg_temp.err('select public.set_request_open((select id from _r42 where number = ''MANUAL_42_1''), true)')
  is null, 'открыть снова можно без причины');
select pg_temp.assert((select is_open from _r42 where number = 'MANUAL_42_1') = true, 'заявка снова открыта');

-- ---------- «Принятая» закрывается без причины ----------
insert into public.requests (number, source, store_id, operation, subject, registered_at, status, priority, created_by)
values ('MANUAL_42_2', 'manual', public.default_store_id(), 'Ремонт', 'Тест 42: принятая',
        (now() at time zone public.app_timezone()), 'accepted', 3,
        (select id from public.employees where login = 'boss'))
on conflict (number) do nothing;
select pg_temp.assert(pg_temp.err('select public.set_request_open((select id from _r42 where number = ''MANUAL_42_2''), false)')
  is null, '«Принятую» можно закрыть без причины');

-- ---------- Заявка инициатора: закрытая видна как «Закрыта» с причиной ----------
insert into public.departments (name) values ('ТестОтдел 42') on conflict do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000424242', '424242@uchet.local')
on conflict do nothing;
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code, login, user_id)
select 'Ольга', 'П', 'initiator', 1, d.id, '424242', '424242', '00000000-0000-0000-0000-000000424242'
from public.departments d where d.name = 'ТестОтдел 42'
on conflict (ldap_code) do nothing;

select pg_temp.login_as('424242');
select pg_temp.err(format('select public.create_initiator_request(''Ремонт'', ''Собрать шкаф тест 42'', null, ''Подиум 2'', null, false, null, null, jsonb_build_array(%L::jsonb))',
  pg_temp.photo(1)::text));
select pg_temp.assert((select count(*) from public.requests where source = 'initiator' and subject like 'Собрать шкаф тест 42%') = 1,
  'заявка инициатора создана');
create temp view _i42 as select id, status, is_open from public.requests
  where source = 'initiator' and subject like 'Собрать шкаф тест 42%';
select pg_temp.assert((select count(*) from public.initiator_requests('my')) = 1, 'инициатор видит свою в «Мои»');

-- МВСО закрывает с причиной; инициатор смотрит списки и карточку
select pg_temp.login_as('boss');
select pg_temp.assert(pg_temp.err(format('select public.set_request_open((select id from _i42), false, ''Товар больше не продаём'')'))
  is null, 'заявка инициатора закрыта с причиной');
select pg_temp.assert(pg_temp.err('select public.set_request_open((select id from _i42), false)')
  like '%причин%', 'повторное закрытие без причины тоже запрещено');

select pg_temp.login_as('424242');
select pg_temp.assert((select count(*) from public.initiator_requests('my')) = 0,
  'закрытой нет в актуальных «Мои»');
select pg_temp.assert((select status from public.initiator_requests('my', true)) = 'closed',
  'в «Истории» статус closed');
select pg_temp.assert((select card ->> 'status' from public.initiator_request_card((select id from _i42)) card) = 'closed',
  'в карточке статус closed');
select pg_temp.assert((select card ->> 'close_comment' from public.initiator_request_card((select id from _i42)) card)
  = 'Товар больше не продаём', 'в карточке причина закрытия');
select pg_temp.assert((select card ->> 'is_mine' from public.initiator_request_card((select id from _i42)) card) = 'true',
  'карточка помечает свою заявку');
select pg_temp.assert((select card ->> 'can_cancel' from public.initiator_request_card((select id from _i42)) card) = 'false',
  'закрытую нельзя отменить');
select pg_temp.assert(pg_temp.err(format('select public.cancel_initiator_request((select id from _i42))'))
  like '%взяли%' or pg_temp.err(format('select public.cancel_initiator_request((select id from _i42))'))
  like '%об отмене%', 'закрытую заявку отменить нельзя');

reset role;
commit;
