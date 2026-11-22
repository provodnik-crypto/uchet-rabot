-- Обратная связь: отправка всеми тремя ролями, список/«прочитано» только у разработчика (логин 60133303),
-- счётчик в my_notifications только у разработчика, прямой доступ к таблице закрыт.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
insert into public.departments (name) values ('ТестОтдел Фидбек') on conflict do nothing;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000601333', '60133303@uchet.local'),
  ('00000000-0000-0000-0000-000000077714', '777145@uchet.local')
on conflict do nothing;
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code, login, user_id)
select 'Дмитрий', 'Р', 'manager', 3, d.id, '60133303', '60133303', '00000000-0000-0000-0000-000000601333'
from public.departments d where d.name = 'ТестОтдел Фидбек';
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code, login, user_id)
select 'Ольга', 'П', 'initiator', 1, d.id, '777145', '777145', '00000000-0000-0000-0000-000000077714'
from public.departments d where d.name = 'ТестОтдел Фидбек';

-- отправка: инициатор, мастер, руководитель (не разработчик)
select pg_temp.login_as('777145');
select pg_temp.assert(pg_temp.err('select public.submit_developer_feedback(''Добавьте фильтр по датам в истории'')')
  is null, 'инициатор отправляет сообщение');
select pg_temp.assert(pg_temp.err('select public.submit_developer_feedback(''ок'')')
  like 'Опишите%', 'короткий текст не принимается');
select pg_temp.assert(pg_temp.err(format('select public.submit_developer_feedback(repeat(''а'', 1001))'))
  like 'Слишком длинно%', 'текст длиннее 1000 не принимается');
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err('select public.submit_developer_feedback(''Материалы не приходят, жду третий день'')')
  is null, 'мастер отправляет сообщение');
select pg_temp.login_as('boss');
select pg_temp.assert(pg_temp.err('select public.submit_developer_feedback(''Проверка от руководителя'')')
  is null, 'руководитель отправляет сообщение');

-- список только у разработчика; boss (manager, не 60133303) — нет доступа
select pg_temp.assert(pg_temp.err('select count(*) from public.developer_feedback_list()')
  like 'Нет доступа%', 'руководитель не видит список (он не разработчик)');
select pg_temp.assert(pg_temp.err('select count(*) from public.developer_feedback')
  like 'permission denied%', 'таблица напрямую закрыта');

-- разработчик: видит все три сообщения, после «прочитано» счётчик 0
select pg_temp.login_as('60133303');
select pg_temp.assert(pg_temp.err('select public.developer_feedback_mark_read()')
  is null, 'разработчик открывает список');
select pg_temp.assert(pg_temp.err('select public.developer_feedback_mark_read()')
  is null, 'разработчик ещё раз открывает список');
select pg_temp.assert((select count(*) from public.developer_feedback_list()) = 3,
  'разработчик видит все три сообщения');
select pg_temp.assert((select count(*) from public.developer_feedback_list() where read_at is null) = 0,
  'после открытия список прочитан');
select pg_temp.assert((public.my_notifications() ->> 'feedback') = '0',
  'счётчик на главной разработчика погас');
select pg_temp.assert(exists (select 1 from public.developer_feedback_list() where author like 'Ольга П.%'),
  'в списке виден автор');

-- счётчик у других: boss (manager) — 0; у мастера my_notifications без ключа feedback
select pg_temp.login_as('boss');
select pg_temp.assert((public.my_notifications() ->> 'feedback') = '0',
  'у руководителя счётчик всегда 0');
select pg_temp.login_as('kolya');
select pg_temp.assert((public.my_notifications() ->> 'feedback') is null,
  'у мастера ключа feedback нет');
reset role;
commit;
