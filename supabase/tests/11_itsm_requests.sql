-- Заявки из ITSM: окно дат по производственному календарю, загрузка без дублей, пропавшие, назначение, права.
-- Имена и номера выдуманные.
begin;
-- окно дат
select pg_temp.assert((select window_from from public.import_window('2026-10-12', '2026-10-09')) = '2026-10-09'
  and (select window_to from public.import_window('2026-10-12', '2026-10-09')) = '2026-10-11', 'понедельник — с пятницы по воскресенье');
select pg_temp.assert((select window_from from public.import_window('2026-10-14', '2026-10-13')) = '2026-10-13', 'среда — за вторник');
select pg_temp.assert((select window_from from public.import_window('2026-10-14', '2026-10-09')) = '2026-10-10',
  'пропустили загрузки — со дня после прошлой');
select pg_temp.assert((select window_from from public.import_window('2026-10-14', null)) is null, 'первая загрузка — без ограничения');
select pg_temp.assert((select window_from from public.import_window('2027-01-11', '2027-01-11')) = '2026-12-30',
  'после новогодних каникул 2027 — с последнего рабочего дня 2026');
select pg_temp.assert((select window_from from public.import_window('2026-11-05', '2026-11-05')) = '2026-11-03', '4 ноября праздник');
select pg_temp.assert((select window_from from public.import_window('2027-02-24', '2027-02-24')) = '2027-02-20',
  'рабочая суббота 20.02.2027 считается рабочим днём');

-- мастер загружать не может
select pg_temp.login_as('kolya');
do $$ begin
  perform public.request_import_apply('{"rows": []}');
  raise exception 'ПРОВАЛ: мастер загрузил заявки';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: мастер не загружает файл';
end $$;
do $$ begin
  perform public.assign_request(1, 1, false);
  raise exception 'ПРОВАЛ: мастер назначил заявку';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: мастер не назначает';
end $$;
reset role;

-- первая загрузка
select pg_temp.login_as('boss');
select pg_temp.assert((public.request_import_context(array['RFS261009_0001']) ->> 'first')::boolean, 'загрузок ещё не было');
create temp table _r1 on commit drop as select public.request_import_apply($j${
  "rows": [
    {"number": "RFS261009_0001", "store_code": "031", "service": "Мебель", "operation": "Ремонт стульев",
     "description": "Сломан стул у кассы 5", "status": "Зарегистрирован", "registered_at": "2026-10-09 10:00:00",
     "requester": "Пётр Т. (60000001)"},
    {"number": "INC261009_0002", "store_code": "031", "operation": "Другие работы", "description": "Розетка",
     "registered_at": "2026-10-09 12:00:00", "requester": "rr13.mag031"},
    {"number": "RFS261010_0003", "store_code": "031", "operation": "Другие работы", "description": "Лампа",
     "registered_at": "2026-10-10 09:00:00", "requester": null}
  ], "file_rows": 3, "existing_rows": 0, "outside_rows": 0, "error_rows": 0}$j$::jsonb) r;
grant select on _r1 to authenticated;
select pg_temp.assert((select (r ->> 'inserted')::int from _r1) = 3, 'первая загрузка: 3 новые');
select pg_temp.assert((select count(*) from public.request_imports) = 1, 'запись в журнале загрузок');
select pg_temp.assert(not (public.request_import_context(array['RFS261009_0001']) ->> 'first')::boolean, 'вторая загрузка уже не первая');
select pg_temp.assert(public.request_import_context(array['RFS261009_0001', 'INC261009_0002']) -> 'missing' @> '[{"number": "RFS261010_0003"}]',
  'открытая заявка, которой нет в файле, — в «Пропали»');
select pg_temp.assert(jsonb_array_length(public.request_import_context(array['RFS261009_0001', 'X']) -> 'existing') = 1, 'уже есть — по номеру');

-- повторная загрузка того же: 0 новых, существующие не меняются
create temp table _r2 on commit drop as select public.request_import_apply($j${
  "rows": [{"number": "RFS261009_0001", "store_code": "031", "description": "Другой текст", "registered_at": "2026-10-09 10:00:00"}],
  "file_rows": 1, "close_ids": []}$j$::jsonb) r;
grant select on _r2 to authenticated;
select pg_temp.assert((select (r ->> 'inserted')::int from _r2) = 0, 'повторная загрузка — 0 новых');
select pg_temp.assert((select description from public.requests where number = 'RFS261009_0001') = 'Сломан стул у кассы 5', 'существующая не меняется');

-- неизвестный магазин и грязные данные не проходят
do $$ begin
  perform public.request_import_apply('{"rows": [{"number": "RFS261009_0009", "store_code": "777", "registered_at": "2026-10-09 10:00:00"}]}');
  raise exception 'ПРОВАЛ: загружен магазин 777';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: магазина нет в справочнике — не загружается';
end $$;
do $$ begin
  perform public.request_import_apply('{"rows": [{"number": "RFS261009_0010", "store_code": "031", "registered_at": "2026-10-09 10:00:00", "description": "звонить 8 900 000 00 00"}]}');
  raise exception 'ПРОВАЛ: телефон в описании';
exception when check_violation then raise notice 'ok: телефон в описание не записать';
end $$;
do $$ begin
  perform public.request_import_apply('{"rows": [{"number": "RFS261009_0011", "store_code": "031", "registered_at": "2026-10-09 10:00:00", "requester": "Тестов Пётр Сидорович (60000001)"}]}');
  raise exception 'ПРОВАЛ: полное ФИО заявителя';
exception when check_violation then raise notice 'ok: заявитель только «Имя Ф. (ldap)»';
end $$;

-- назначение
select public.assign_request((select id from public.requests where number = 'INC261009_0002'),
                             (select id from public.employees where login = 'kolya'), false);
select public.assign_request((select id from public.requests where number = 'RFS261010_0003'), null, true);
reset role;

-- мастер: список, сначала назначенные ему, «Имя Ф.» без ldap
select pg_temp.login_as('kolya');
select pg_temp.assert((select number from public.open_requests('', 'all') limit 1) = 'INC261009_0002', 'назначенная мне — первой');
select pg_temp.assert((select bool_and(mine) from public.open_requests('', 'mine')) and (select count(*) from public.open_requests('', 'mine')) = 1, 'фильтр «Назначены мне»');
select pg_temp.assert((select count(*) from public.open_requests('', 'contractor')) = 1, 'фильтр «Подрядчик»');
select pg_temp.assert((select requester_name from public.open_requests('стул', 'all')) = 'Пётр Т.', 'мастер видит «Имя Ф.» без номера');
do $$ begin
  perform requester from public.requests limit 1;
  raise exception 'ПРОВАЛ: мастер читает заявителя напрямую';
exception when insufficient_privilege then raise notice 'ok: номер заявителя мастеру недоступен';
end $$;
do $$ begin
  perform public.request_import_context(array[]::text[]);
  raise exception 'ПРОВАЛ: мастер видит предпросмотр';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: предпросмотр только руководителю';
end $$;
reset role;

-- принятую заявку в списке мастера не показываем
update public.requests set status = 'accepted' where number = 'INC261009_0002';
select pg_temp.login_as('kolya');
select pg_temp.assert(not exists (select 1 from public.open_requests('', 'all') where number = 'INC261009_0002'), 'принятая — не в списке');
reset role;
update public.requests set status = 'waiting' where number = 'INC261009_0002';

-- закрыть пропавшую: только по подтверждению руководителя
select pg_temp.login_as('boss');
select public.request_import_apply(jsonb_build_object('rows', '[]'::jsonb, 'file_rows', 0,
  'close_ids', jsonb_build_array((select id from public.requests where number = 'RFS261010_0003'))));
select pg_temp.assert(not (select is_open from public.requests where number = 'RFS261010_0003'), 'отмеченная «Закрыть» закрыта');
select pg_temp.assert((select is_open from public.requests where number = 'INC261009_0002'), 'остальные открыты');
select public.set_request_open((select id from public.requests where number = 'RFS261010_0003'), true);
select pg_temp.assert((select is_open from public.requests where number = 'RFS261010_0003'), 'руководитель может открыть снова');
select pg_temp.assert((select operation = 'Ремонт стульев' and plan_minutes is null and spent_minutes is null
                       from public.list_requests('RFS261009_0001', 10)), 'список руководителя: поля ITSM и время вместе');
reset role;
rollback;
