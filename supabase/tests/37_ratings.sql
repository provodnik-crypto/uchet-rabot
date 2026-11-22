-- Оценки (часть 2 «Инициаторов»): подача оценки своей выполненной заявки, повторная — отказ,
-- шлюз «сначала оцените» при создании новой, чужая/мастеру — отказ, руководитель видит оценку.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.photo(p_n int) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid() || '/' || md5('h' || p_n)::uuid || '.jpg',
                            'thumb_path', auth.uid() || '/' || md5('h' || p_n)::uuid || '_t.jpg') $$;

begin;
insert into public.departments (name) values ('ТестОтдел Оценок') on conflict do nothing;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000077723', '777123@uchet.local'),
  ('00000000-0000-0000-0000-000000088845', '888456@uchet.local')
on conflict do nothing;
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code, login, user_id)
select 'Ольга', 'П', 'initiator', 1, d.id, '777123', '777123', '00000000-0000-0000-0000-000000077723'
from public.departments d where d.name = 'ТестОтдел Оценок'
on conflict (ldap_code) do nothing;
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code, work_phone, login, user_id)
select 'Павел', 'С', 'initiator', 2, d.id, '888456', '031999', '888456', '00000000-0000-0000-0000-000000088845'
from public.departments d where d.name = 'ТестОтдел Оценок'
on conflict (ldap_code) do nothing;

create temp table _e on commit drop as select id, ldap_code from public.employees
  where ldap_code in ('777123', '888456');
create function pg_temp.init(p_ldap text) returns bigint language sql as $$
  select id from _e where ldap_code = p_ldap $$;
grant all on _e to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

-- заявка выполнена (упрощение: статус ставим прямо, оценка ставится только на accepted)
select pg_temp.login_as('777123');
create temp table _r on commit drop as
  select (public.create_initiator_request('Ремонт', 'Собрать шкаф для оценки', null, 'Подиум 3', null,
          false, null, null, jsonb_build_array(pg_temp.photo(1), pg_temp.photo(2))) ->> 'id')::bigint as id;
grant all on _r to authenticated;
reset role;
update public.requests set status = 'accepted' where id = (select id from _r);

-- до оценки: pending показывает заявку; шлюз не пускает новую
select pg_temp.login_as('777123');
select pg_temp.assert((select count(*) from public.initiator_pending_ratings()) = 1,
  'выполненная без оценки в списке «Оцените»');
select pg_temp.assert(pg_temp.err(format('select public.create_initiator_request(''Ремонт'', ''Ещё шкаф'', null, ''Подиум 3'', null, false, null, null, jsonb_build_array(%L::jsonb))',
  pg_temp.photo(3)::text)) like 'Сначала оцените заявку № %', 'шлюз: сначала оцените выполненную');
select pg_temp.assert(pg_temp.err('select public.submit_initiator_rating((select id from _r), 0::smallint, null)')
  like '%от 1 до 5%', 'оценка только 1–5');
select pg_temp.assert(pg_temp.err('select public.submit_initiator_rating((select id from _r), 6::smallint, null)')
  like '%от 1 до 5%', 'оценка больше 5 запрещена');

-- чужая заявка и мастер: отказ
select pg_temp.login_as('888456');
select pg_temp.assert(pg_temp.err('select public.submit_initiator_rating((select id from _r), 5::smallint, null)')
  like '%только свою%', 'чужую заявку оценить нельзя');
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err('select public.submit_initiator_rating((select id from _r), 5::smallint, null)')
  like 'Нет доступа%', 'мастер не инициатор — оценка недоступна');

-- успешная оценка; повторная — отказ; pending пуст; шлюз открыт
select pg_temp.login_as('777123');
select pg_temp.assert(pg_temp.err('select public.submit_initiator_rating((select id from _r), 4::smallint, ''Спасибо, быстро'')')
  is null, 'свою выполненную заявку оценили');
select pg_temp.assert(pg_temp.err('select public.submit_initiator_rating((select id from _r), 5::smallint, null)')
  like '%уже оценена%', 'повторная оценка невозможна');
select pg_temp.assert((select count(*) from public.initiator_pending_ratings()) = 0,
  'после оценки «Оцените» пусто');
select pg_temp.assert(pg_temp.err(format('select public.create_initiator_request(''Ремонт'', ''Шкаф после оценки'', null, ''Подиум 3'', null, false, null, null, jsonb_build_array(%L::jsonb))',
  pg_temp.photo(3)::text)) is null, 'после оценки новая заявка создаётся');
select pg_temp.assert((select public.initiator_request_card((select id from _r)) ->> 'can_rate') = 'false',
  'карточка: can_rate сброшен после оценки');
select pg_temp.assert((select public.initiator_request_card((select id from _r)) ->> 'rating_score') = '4',
  'карточка показывает свою оценку');

-- мастер не видит оценки (таблица без грантов); руководитель видит оценку и комментарий
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err('select count(*) from public.request_ratings')
  like 'permission denied%', 'мастеру оценки недоступны напрямую');
select pg_temp.login_as('boss');
select pg_temp.assert((public.request_initiator_info((select id from _r)) ->> 'rating_score') = '4',
  'руководитель видит оценку');
select pg_temp.assert((public.request_initiator_info((select id from _r)) ->> 'rating_comment') = 'Спасибо, быстро',
  'руководитель видит комментарий');
reset role;
commit;
