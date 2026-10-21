-- Этап 2: закрытие заявки в работе снимает её с мастера; «Закрыть все»/«Закрыть старые» не трогают заявки у мастеров;
-- отключение мастера освобождает его заявки; устаревшие просьбы мастеров закрываются сами.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка А');
select public.create_manual_request('Заявка Б');
select public.create_manual_request('Заявка В');
select public.create_manual_request('Заявка Г');
select public.create_manual_request('Заявка Д');
reset role;
insert into public.requests (number, source, registered_at, operation) values
  ('RFS250101_0001', 'itsm', '2025-01-01 10:00', 'Старая свободная'),
  ('RFS250101_0002', 'itsm', '2025-01-01 10:00', 'Старая в работе'),
  ('RFS250101_0003', 'itsm', '2025-01-01 10:00', 'Пропала из файла');
create temp table _r on commit drop as select id, operation from public.requests where operation like 'Заявка %' or operation in ('Старая свободная', 'Старая в работе', 'Пропала из файла');
grant all on _r to authenticated;
create function pg_temp.rid(p text) returns bigint language sql as $$ select id from _r where operation = p $$;
grant execute on all functions in schema pg_temp to authenticated;

-- 1. закрыли заявку, которая у мастера в работе, — она снята с мастера, мастер свободен
select pg_temp.login_as('kolya');
select public.take_request(pg_temp.rid('Заявка А'), null);
reset role;
select pg_temp.login_as('boss');
select public.set_request_open(pg_temp.rid('Заявка А'), false);
select pg_temp.assert((select status || '/' || is_open::text || '/' || coalesce(responsible_id::text, '-') from public.requests where id = pg_temp.rid('Заявка А')) = 'waiting/false/-',
  'закрытая снята с мастера');
reset role;
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err(format('select public.take_request(%s, null)', pg_temp.rid('Заявка Б'))) is null, 'мастер свободен — берёт другую');
reset role;

-- 2. «Закрыть старые» и «Закрыть все» не трогают заявку у мастера
select pg_temp.login_as('kolya');
select public.refuse_request(pg_temp.rid('Заявка Б'), 'Освобождаюсь');
select public.take_request(pg_temp.rid('Старая в работе'), null);
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert(public.old_open_skipped('2026-01-01') = 1, 'старых у мастеров — 1 (пропущена)');
select pg_temp.assert((select count(*) from public.old_open_requests('2026-01-01')) = 2, 'в списке к закрытию — только 2');
select public.close_old_requests('2026-01-01');
select pg_temp.assert((select is_open from public.requests where id = pg_temp.rid('Старая в работе')), 'заявка у мастера не закрыта');
select pg_temp.assert(not (select is_open from public.requests where id = pg_temp.rid('Старая свободная')), 'свободная старая закрыта');
select public.set_request_open(pg_temp.rid('Пропала из файла'), true);
select public.request_import_apply(jsonb_build_object('rows', '[]'::jsonb,
  'close_ids', jsonb_build_array(pg_temp.rid('Старая в работе'), pg_temp.rid('Пропала из файла'))));
select pg_temp.assert((select is_open from public.requests where id = pg_temp.rid('Старая в работе')), '«Закрыть все» не закрыл заявку у мастера');
select pg_temp.assert(not (select is_open from public.requests where id = pg_temp.rid('Пропала из файла')), '«Закрыть все» закрыл свободную');
select pg_temp.assert((select (x ->> 'status') = 'in_work' and (x ->> 'master') is not null
  from jsonb_array_elements(public.request_import_context(array[]::text[]) -> 'missing') x where (x ->> 'id')::bigint = pg_temp.rid('Старая в работе')),
  'в «пропали из файла» видны статус и мастер');
reset role;

-- 3. устаревшая просьба мастера закрывается сама, решить её нельзя
select pg_temp.login_as('kolya');
select public.cant_do(pg_temp.rid('Старая в работе'), 'not_needed', 'Сделали до нас');
select public.refuse_request(pg_temp.rid('Старая в работе'), 'Ухожу с заявки');
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert((public.list_master_reports() -> 0 ->> 'status') = 'rejected', 'просьба после отказа — неактуальна');
select pg_temp.assert(pg_temp.err(format($q$select public.decide_master_report(%s, 'close')$q$, (public.list_master_reports() -> 0 ->> 'id')))
  = 'Просьба уже решена или устарела', 'устаревшую не решить');
reset role;

-- 4. открытая просьба «передать подрядчику» остаётся в счётчике после «прочитано»
select pg_temp.login_as('kolya');
select public.take_request(pg_temp.rid('Заявка В'), null);
select public.cant_do(pg_temp.rid('Заявка В'), 'contractor', 'Нужна вышка');
reset role;
select pg_temp.login_as('boss');
select public.decide_master_report((public.list_master_reports() -> 0 ->> 'id')::bigint, 'read');
select pg_temp.assert((public.my_notifications() ->> 'reports')::int = 1, 'прочитанная, но не решённая просьба — в счётчике');
reset role;

-- 5. отключение мастера: заявки освобождаются, назначения снимаются
select pg_temp.login_as('boss');
select public.assign_request(pg_temp.rid('Заявка Д'), (select id from public.employees where login = 'misha'), false);
reset role;
select pg_temp.login_as('misha');
select public.take_request(pg_temp.rid('Заявка Г'), null);
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert(jsonb_array_length(public.employee_open_requests((select id from public.employees where login = 'misha')) -> 'requests') = 1,
  'перед отключением видно его заявку');
reset role;
update public.employees set is_active = false where login = 'misha';
select pg_temp.assert((select status || '/' || coalesce(responsible_id::text, '-') from public.requests where id = pg_temp.rid('Заявка Г')) = 'waiting/-',
  'отключили — заявка свободна');
select pg_temp.assert((select assignee_id is null from public.requests where id = pg_temp.rid('Заявка Д')), 'назначение снято');
rollback;
