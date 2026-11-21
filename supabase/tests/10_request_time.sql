-- Время по заявкам, заявка «В работе» переходит на следующий день, план и статистика времени.
-- (С 14.10.2026 «Не закончено» нет: заявка в работе, пока мастер не отправит её на проверку.)
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where first_name = p_name or display_name = p_name $$;
create or replace function pg_temp.bench(p_req text, p_qty int, p_perf bigint[]) returns jsonb language sql as $$
  select jsonb_build_object('request_number', p_req, 'department_id', (select id from public.departments where is_default),
    'price_item_id', (select id from public.price_items where full_name = 'Благоустройство: Малые архитектурные формы: Установка скамеек'),
    'quantity', p_qty, 'performer_ids', to_jsonb(p_perf)) $$;
create or replace function pg_temp.custom(p_name text, p_perf bigint[]) returns jsonb language sql as $$
  select jsonb_build_object('department_id', (select id from public.departments where is_default),
    'custom_name', p_name, 'unit_id', 1, 'quantity', 1, 'performer_ids', to_jsonb(p_perf)) $$;
create or replace function pg_temp.fails(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ПРОВАЛ: %', p_msg;
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: % (%)', p_msg, sqlerrm;
end $$;

begin;
create temp table _ids (k text primary key, v uuid);
insert into _ids values ('y', gen_random_uuid()), ('t', gen_random_uuid()), ('t2', gen_random_uuid());
grant select on _ids to authenticated;

-- вчера: заявка не закончена, 2 ч; плановые работы без заявки — 1 ч
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', (select v from _ids where k = 'y'), 'work_date', public.app_today() - 1,
  'entries', jsonb_build_array(pg_temp.bench('RFS261011_0100', 1, array[pg_temp.emp('Николай')]),
                               pg_temp.custom('Уборка склада', array[pg_temp.emp('Николай')])),
  'requests', jsonb_build_array(
    jsonb_build_object('request_number', 'RFS261011_0100', 'minutes', 120, 'status', 'unfinished'),
    jsonb_build_object('request_number', null, 'minutes', 60))));
select pg_temp.assert((select status || '/' || state from public.requests where number = 'RFS261011_0100') = 'in_work/open', 'заявка с работами — в работе у мастера');
select pg_temp.assert((select number || ' ' || spent_minutes || ' ' || entries from public.my_open_requests())
  = 'RFS261011_0100 120 1', 'заявка в работе переходит к мастеру: сколько времени и работ');

-- другой мастер её не получает
reset role;
select pg_temp.login_as('misha');
select pg_temp.assert(not exists (select 1 from public.my_open_requests()), 'чужая незаконченная заявка у другого мастера не появляется');
reset role;

-- сегодня: доделали вдвоём, 3 ч, отправили на проверку, руководитель принял
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', (select v from _ids where k = 't'), 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.bench('RFS261011_0100', 1, array[pg_temp.emp('Николай'), pg_temp.emp('Михаил')])),
  'requests', jsonb_build_array(jsonb_build_object('request_number', 'RFS261011_0100', 'minutes', 180, 'status', 'done'))));
select public.send_request_for_review((select id from public.requests where number = 'RFS261011_0100'));
reset role;
select pg_temp.login_as('boss');
select public.accept_request((select id from public.requests where number = 'RFS261011_0100'));
reset role;
select pg_temp.login_as('kolya');
select pg_temp.assert((select state from public.requests where number = 'RFS261011_0100') = 'done', 'принятая заявка — выполнена');
select pg_temp.assert(not exists (select 1 from public.my_open_requests()), 'принятая заявка больше не переносится');
select pg_temp.assert((select spent_minutes from public.requests_time(array['RFS261011_0100'])) = 300, 'время по заявке копится по дням: 2 ч + 3 ч');
select pg_temp.assert((select spent_minutes from public.requests_time(array['RFS261011_0100'], (select v from _ids where k = 't'))) = 120,
  'при правке смены её собственное время не считается дважды');
select pg_temp.assert((select string_agg(coalesce(request_number, '—') || ':' || minutes || ':' || coalesce(status, '—'), ',')
  from public.my_shift_requests((select v from _ids where k = 'y'))) = 'RFS261011_0100:120:done,—:60:—', 'время своей смены для правки');

-- смена только со временем по перенесённой заявке (без новых работ)
select public.submit_shift(jsonb_build_object('client_uuid', (select v from _ids where k = 't2'), 'work_date', public.app_today(),
  'entries', '[]'::jsonb,
  'requests', jsonb_build_array(jsonb_build_object('request_number', 'RFS261011_0101', 'minutes', 60, 'status', 'unfinished'))));
select pg_temp.assert((select count(*) from public.my_open_requests()) = 1, 'смена только со временем принимается, заявка берётся в работу');

select pg_temp.fails($q$select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(), 'entries', '[]'::jsonb))$q$,
  'пустая смена без времени не принимается');
select pg_temp.fails($q$select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.custom('Тест', array[pg_temp.emp('Николай')])),
  'requests', jsonb_build_array(jsonb_build_object('minutes', 20))))$q$, 'время только с шагом 15 минут');
select pg_temp.fails($q$select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.custom('Тест', array[pg_temp.emp('Николай')])),
  'requests', jsonb_build_array(jsonb_build_object('request_number', 'RFS261011_0200', 'minutes', 60), jsonb_build_object('request_number', 'RFS261011_0200', 'minutes', 60))))$q$,
  'одна заявка дважды в смене');
-- старая версия приложения без времени работает как раньше
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.custom('Старое приложение', array[pg_temp.emp('Николай')]))));
select pg_temp.assert(true, 'смена от старой версии приложения (без времени) принимается');

select pg_temp.fails('select * from public.shift_requests', 'мастер не читает таблицу времени напрямую');
select pg_temp.fails('select public.time_stats(current_date, current_date)', 'статистика времени — только руководителю');
update public.requests set plan_minutes = 60 where number = 'RFS261011_0100';
select pg_temp.assert((select plan_minutes from public.requests where number = 'RFS261011_0100') is null, 'мастер не задаёт план');
reset role;

-- руководитель: план, список заявок, статистика
select pg_temp.login_as('boss');
update public.requests set plan_minutes = 240 where number = 'RFS261011_0100';
select pg_temp.assert((select plan_minutes || '/' || spent_minutes || '/' || state || '/' || carries from public.list_requests('0100'))
  = '240/300/done/0', 'в списке заявок: план, факт, состояние (переносов «Не закончено» больше нет)');
select pg_temp.assert((select (s -> 'over_plan' -> 0 ->> 'number') from public.time_stats(public.app_today() - 1, public.app_today()) s) = 'RFS261011_0100',
  'заявка дольше плана попадает в статистику');
select pg_temp.assert((select (s -> 'kinds') @> '[{"kind": "Благоустройство", "jobs": 1, "avg_minutes": 300, "median_minutes": 300}]'
  from public.time_stats(public.app_today() - 1, public.app_today()) s), 'среднее и медиана по виду работ');
select pg_temp.assert((select (s -> 'kinds') @> '[{"kind": "Работы вне прайса", "jobs": 1, "avg_minutes": 60}]'
  from public.time_stats(public.app_today() - 1, public.app_today()) s), 'работы без заявки — отдельным заданием за смену');
select pg_temp.assert((select (s -> 'masters') @> '[{"display_name": "Михаил М.", "requests": 1, "minutes": 300, "ratio": 1.0}]'
  from public.time_stats(public.app_today() - 1, public.app_today()) s), 'напарнику засчитывается время бригады, сравнение со средним');
select pg_temp.assert((select (s ->> 'requests')::int = 2
  from public.time_stats(public.app_today() - 1, public.app_today()) s), 'заявок со временем за период');
select pg_temp.assert(not ((select s -> 'kinds' from public.time_stats(public.app_today() - 1, public.app_today()) s) @> '[{"kind": "Без категории"}]'),
  'незакрытая заявка в среднее не входит');

-- руководитель снимает заявку с мастера
select public.set_request_responsible((select id from public.requests where number = 'RFS261011_0101'), null);
reset role;
select pg_temp.login_as('kolya');
select pg_temp.assert(not exists (select 1 from public.my_open_requests()), 'руководитель снял заявку — у мастера она больше не появляется');
reset role;

-- правка сегодняшней смены пересчитывает время
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', (select v from _ids where k = 't'), 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.bench('RFS261011_0100', 1, array[pg_temp.emp('Николай')])),
  'requests', jsonb_build_array(jsonb_build_object('request_number', 'RFS261011_0100', 'minutes', 60, 'status', 'unfinished'))));
select pg_temp.assert((select spent_minutes from public.requests_time(array['RFS261011_0100'])) = 180, 'правка смены меняет время заявки');
select pg_temp.assert((select status from public.requests where number = 'RFS261011_0100') = 'accepted', 'правка смены не меняет статус принятой заявки');
reset role;
rollback;
