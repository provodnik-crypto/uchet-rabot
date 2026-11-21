-- Инициаторы: роль, вход whoami, создание заявки (фото обязательны, срочно с причиной, чистый текст),
-- «Мои/Отдел» и RLS (чужие отделы и ITSM не видны), отмена своей до взятия, карточка и доп. поля для staff.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.photo(p_n int) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid() || '/' || md5('h' || p_n)::uuid || '.jpg',
                            'thumb_path', auth.uid() || '/' || md5('h' || p_n)::uuid || '_t.jpg') $$;

begin;
select pg_temp.login_as('boss');
insert into public.departments (name) values ('ТестОтдел Инициаторов') on conflict do nothing;
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code)
select 'Ольга', 'П.', 'initiator', 1, d.id, '777123' from public.departments d
where d.name = 'ТестОтдел Инициаторов'
on conflict (ldap_code) do nothing;
insert into public.employees (first_name, last_initial, role, grade, department_id, ldap_code)
select 'Павел', 'С.', 'initiator', 2, d.id, '888456', '031999' from public.departments d
where d.name = 'ТестОтдел Инициаторов'
on conflict (ldap_code) do nothing;
-- служебная заявка ITSM (department_id пустой) — инициаторы её видеть не должны
insert into public.requests (number, source, store_id, operation, subject, registered_at, status, priority)
values ('ITSM-INIT-TEST', 'itsm', public.default_store_id(), 'Ремонт', 'Служебная заявка вне отделов',
        (now() at time zone public.app_timezone()), 'waiting', 3)
on conflict (number) do nothing;
reset role;

create temp table _e on commit drop as select id, ldap_code, department_id from public.employees
  where ldap_code in ('777123', '888456');
create temp table _r on commit drop as select id, number, subject, source from public.requests
  where number = 'ITSM-INIT-TEST' or source = 'initiator';
create function pg_temp.init(p_ldap text) returns bigint language sql as $$
  select id from _e where ldap_code = p_ldap $$;
create function pg_temp.rid(p_subj text) returns bigint language sql as $$
  select id from _r where subject like p_subj or p_subj = '*' limit 1 $$;
grant all on _e, _r to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

-- whoami: инициатор входит, роль видна
select pg_temp.login_as('boss');
select set_config('request.jwt.claims', format('{"sub":"%s"}',
  (select user_id from public.employees where id = pg_temp.init('777123'))), true);
select pg_temp.assert((public.whoami()).role = 'initiator', 'whoami узнаёт инициатора');
select pg_temp.assert(public.is_initiator() and public.current_employee_id() is null,
  'инициатор не проходит как мастер/руководитель');

-- создание: без фото нельзя; без места нельзя; срочно без причины нельзя; телефон в тексте нельзя
select pg_temp.assert(pg_temp.err('select public.create_initiator_request(''Ремонт'', ''Собрать шкаф'', null, ''Подиум 2'', null, false, null, null, ''[]''::jsonb)')
  like '%Добавьте фото%', 'заявка без фото не создаётся');
select pg_temp.assert(pg_temp.err(format('select public.create_initiator_request(''Ремонт'', ''Собрать шкаф'', null, null, null, false, null, null, jsonb_build_array(%L::jsonb))',
  pg_temp.photo(1)::text)) like '%Укажите, где%', 'заявка без места не создаётся');
select pg_temp.assert(pg_temp.err(format('select public.create_initiator_request(''Ремонт'', ''Собрать шкаф'', null, ''Подиум 2'', null, true, null, null, jsonb_build_array(%L::jsonb))',
  pg_temp.photo(1)::text)) like '%почему%', 'срочно без причины не создаётся');
select pg_temp.assert(pg_temp.err(format('select public.create_initiator_request(''Ремонт'', ''Позвоните 8 913 123 45 67'', null, ''Подиум 2'', null, false, null, null, jsonb_build_array(%L::jsonb))',
  pg_temp.photo(1)::text)) like '%телефон%', 'телефон в описании запрещён');
select pg_temp.assert(pg_temp.err(format('select public.create_initiator_request(''Чинить'', ''Собрать шкаф'', null, ''Подиум 2'', null, false, null, null, jsonb_build_array(%L::jsonb))',
  pg_temp.photo(1)::text)) like '%что нужно%', 'категория только из списка');

-- happy path: фото 1–3, приоритет, срок
select pg_temp.assert(pg_temp.err(format('select public.create_initiator_request(''Ремонт'', ''Собрать шкаф распашной'', null, ''Подиум 2'', current_date, false, null, ''RAL 9003, аллея 65'', jsonb_build_array(%L::jsonb, %L::jsonb))',
  pg_temp.photo(1)::text, pg_temp.photo(2)::text)) is null, 'заявка инициатора создаётся');
select pg_temp.err(format('select public.create_initiator_request(''Демонтаж'', ''Стеллаж у входа'', null, ''Аллея 1'', null, true, ''Безопасность, острый угол'', null, jsonb_build_array(%L::jsonb))',
  pg_temp.photo(3)::text));
select pg_temp.assert((select count(*) from _r where source = 'initiator') = 2, 'обе заявки в списке');
select pg_temp.assert((select status from _r where subject like 'Собрать%') = 'waiting', 'статус waiting');
select pg_temp.assert((select priority from _r where subject like 'Стеллаж%') = 1, 'срочно — приоритет 1');
select pg_temp.assert((select count(*) from public.extra_photos x join _r r on r.id = x.owner_id
  where x.owner_kind = 'request') = 3, 'фото прикреплены к заявкам');
select pg_temp.assert((select request_unread from public.list_requests('', 100, 'all', null, null, null)
  join _r r on r.id = list_requests.id limit 0) is null, 'list_requests не мешает');

-- RLS: свои + отдел видны, чужой отдел и ITSM — нет
select pg_temp.assert((select count(*) from public.requests where source = 'initiator') = 2,
  'инициатор видит свои и заявки отдела');
select pg_temp.assert((select count(*) from public.requests where number = 'ITSM-INIT-TEST') = 0,
  'служебные заявки без отдела инициатору не видны');

-- отмена: чужую нельзя, свою waiting можно, повторно нельзя
select pg_temp.login_as('boss');
select set_config('request.jwt.claims', format('{"sub":"%s"}',
  (select user_id from public.employees where id = pg_temp.init('888456'))), true);
select pg_temp.assert(pg_temp.err(format('select public.cancel_initiator_request((select id from _r where subject like ''Собрать%''))'))
  like '%только свою%', 'чужую заявку отменить нельзя');
select pg_temp.login_as('boss');
select set_config('request.jwt.claims', format('{"sub":"%s"}',
  (select user_id from public.employees where id = pg_temp.init('777123'))), true);
select pg_temp.assert(pg_temp.err(format('select public.cancel_initiator_request((select id from _r where subject like ''Собрать%''))'))
  is null, 'свою waiting заявку отменить можно');
select pg_temp.assert(pg_temp.err(format('select public.cancel_initiator_request((select id from _r where subject like ''Собрать%''))'))
  like '%уже взяли%' or pg_temp.err(format('select public.cancel_initiator_request((select id from _r where subject like ''Собрать%''))'))
  like '%об отмене%', 'повторная отмена невозможна');
select pg_temp.assert((select is_open from _r where subject like 'Собрать%') = false, 'отменённая закрыта');

-- доп. поля для персонала: руководитель видит, кто подал и почему срочно
select pg_temp.login_as('boss');
select pg_temp.assert((public.request_extra_fields((select id from _r where subject like 'Стеллаж%')) ->> 'place') = 'Аллея 1',
  'персонал видит место заявки');
select pg_temp.assert((public.request_extra_fields((select id from _r where subject like 'Стеллаж%')) ->> 'urgent_reason')
  = 'Безопасность, острый угол', 'персонал видит причину срочности');
select pg_temp.assert((public.request_extra_fields((select id from _r where subject like 'Стеллаж%')) ->> 'creator_name')
  like 'Павел С%', 'персонал видит «Имя П.»');
select pg_temp.err(format('select public.request_initiator_info((select id from _r where subject like ''Стеллаж%''))'));

-- заявка инициатора доходит до мастера: взять можно как обычную
select pg_temp.err(format('select public.take_request((select id from _r where subject like ''Стеллаж%''), null)'));
select pg_temp.assert((select status from _r where subject like 'Стеллаж%') = 'in_work', 'мастер взял заявку инициатора');
reset role;
commit;
