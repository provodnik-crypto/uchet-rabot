-- История (этап 22.11.2026): «Мои»/«Отдел» — только актуальные (незакрытые и не выполненные);
-- p_history=true — отработанные (закрытые/выполненные), свежие сверху; scope my/department/all; RLS отделов.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.photo(p_n int) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid() || '/' || md5('h' || p_n)::uuid || '.jpg',
                            'thumb_path', auth.uid() || '/' || md5('h' || p_n)::uuid || '_t.jpg') $$;

begin;
-- seed под postgres-ролью: отдел + два инициатора с учётками (auth.users ДО employees)
insert into public.departments (name) values ('ТестОтдел Истории') on conflict do nothing;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000077321', '777321@uchet.local'),
  ('00000000-0000-0000-0000-000000088654', '888654@uchet.local')
on conflict do nothing;
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code, login, user_id)
select 'Ольга', 'П', 'initiator', 1, d.id, '777321', '777321', '00000000-0000-0000-0000-000000077321'
from public.departments d where d.name = 'ТестОтдел Истории' on conflict (ldap_code) do nothing;
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code, login, user_id)
select 'Павел', 'С', 'initiator', 2, d.id, '888654', '888654', '00000000-0000-0000-0000-000000088654'
from public.departments d where d.name = 'ТестОтдел Истории' on conflict (ldap_code) do nothing;

-- три заявки от Ольги: A (закроем), B (актуальная), C (выполним)
select pg_temp.login_as('777321');
create temp table _ra on commit drop as
  select (public.create_initiator_request('Ремонт', 'История шкаф закрытый', null, 'Подиум 1', null,
          false, null, null, jsonb_build_array(pg_temp.photo(1))) ->> 'id')::bigint as id;
create temp table _rb on commit drop as
  select (public.create_initiator_request('Ремонт', 'История шкаф актуальный', null, 'Подиум 2', null,
          false, null, null, jsonb_build_array(pg_temp.photo(2))) ->> 'id')::bigint as id;
create temp table _rc on commit drop as
  select (public.create_initiator_request('Ремонт', 'История шкаф выполнен', null, 'Подиум 3', null,
          false, null, null, jsonb_build_array(pg_temp.photo(3))) ->> 'id')::bigint as id;
grant all on _ra, _rb, _rc to authenticated;
select pg_temp.assert(pg_temp.err('select public.cancel_initiator_request((select id from _ra))')
  is null, 'свою waiting заявку отменили (закрытая для истории)');
reset role;
update public.requests set status = 'accepted' where id = (select id from _rc);

-- актуальные «Мои»: только B; закрытая A и выполненная C не видны
select pg_temp.login_as('777321');
select pg_temp.assert((select count(*) from public.initiator_requests('my')
  where id in ((select id from _ra), (select id from _rc))) = 0, 'закрытая и выполненная не видны в актуальных «Мои»');
select pg_temp.assert((select count(*) from public.initiator_requests('my') where id = (select id from _rb)) = 1,
  'актуальная заявка видна в «Мои»');

-- история «Мои»: ровно A и C, свежая (C) сверху; B не видна
select pg_temp.assert((select count(*) from public.initiator_requests('my', true)
  where id in ((select id from _ra), (select id from _rc))) = 2, 'история «Мои»: закрытая и выполненная видны');
select pg_temp.assert((select count(*) from public.initiator_requests('my', true) where id = (select id from _rb)) = 0,
  'актуальная не попадает в историю');
select pg_temp.assert((select id from public.initiator_requests('my', true) limit 1) = (select id from _rc),
  'в истории свежая сверху');

-- актуальные «Отдел» Павла: видит B Ольги; история «Отдел»: A и C, не B
select pg_temp.login_as('888654');
select pg_temp.assert((select count(*) from public.initiator_requests('department') where id = (select id from _rb)) = 1,
  'актуальная отдела видна Павлу');
select pg_temp.assert((select count(*) from public.initiator_requests('department')
  where id in ((select id from _ra), (select id from _rc))) = 0, 'отработанные не видны в актуальных «Отдел»');
select pg_temp.assert((select count(*) from public.initiator_requests('department', true)
  where id in ((select id from _ra), (select id from _rc))) = 2, 'история «Отдел»: отработанные отдела видны');
select pg_temp.assert((select count(*) from public.initiator_requests('my', true)) = 0,
  'история «Мои» Павла пуста (своих закрытых нет)');

-- история «Все заявки» (магазин): содержит A и C; чужого магазина — нет (проверка по составу)
select pg_temp.assert((select count(*) from public.initiator_requests('all', true)
  where id in ((select id from _ra), (select id from _rc))) = 2, 'история «Все»: отработанные магазина видны');
select pg_temp.assert((select count(*) from public.initiator_requests('all', true) where id = (select id from _rb)) = 0,
  'актуальная не видна и в «Все»');

-- мастер не инициатор — доступа нет
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err('select count(*) from public.initiator_requests(''my'', true)')
  like 'Нет доступа%', 'мастеру история недоступна');
reset role;
commit;
