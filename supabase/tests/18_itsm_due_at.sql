-- Срок ITSM («Время разрешения»): сохраняется при загрузке, обновляется при повторной, виден мастеру и руководителю.
begin;
select pg_temp.login_as('boss');
create temp table _a on commit drop as select public.request_import_apply($j${
  "rows": [
    {"number": "RFS261016_0001", "store_code": "031", "service": "Общие заявки", "operation": "Поменять фильтры",
     "description": "Поменять фильтры в ауд. 2.30", "status": "В работе", "registered_at": "2026-10-16 11:51:10",
     "due_at": "2026-11-01 11:21:16"},
    {"number": "RFS251007_0002", "store_code": "031", "operation": "Старая", "description": "Старая",
     "registered_at": "2025-10-07 08:39:20", "due_at": "2025-10-21 09:06:28"}
  ], "file_rows": 2}$j$::jsonb) r;
grant select on _a to authenticated;
select pg_temp.assert((select (r ->> 'inserted')::int from _a) = 2, 'загружены 2 заявки со сроком');
select pg_temp.assert((select due_at from public.requests where number = 'RFS261016_0001') = '2026-11-01 11:21:16', 'срок сохранён');

-- повторная загрузка: у существующей обновляется только срок, новых 0
create temp table _b on commit drop as select public.request_import_apply($j${
  "rows": [], "due_updates": [{"number": "RFS261016_0001", "due_at": "2026-11-05 10:00:00"}], "file_rows": 1}$j$::jsonb) r;
grant select on _b to authenticated;
select pg_temp.assert((select (r ->> 'inserted')::int from _b) = 0, 'повторная загрузка — 0 новых');
select pg_temp.assert((select due_at || ' / ' || description from public.requests where number = 'RFS261016_0001')
  = '2026-11-05 10:00:00 / Поменять фильтры в ауд. 2.30', 'обновился только срок');
select pg_temp.assert((select due_at from public.list_requests('RFS261016_0001')) = '2026-11-05 10:00:00', 'срок в списке руководителя');
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert((select due_at from public.open_requests('RFS251007_0002')) = '2025-10-21 09:06:28', 'срок в списке мастера');
select pg_temp.assert((select public.request_card(null, 'RFS261016_0001') ->> 'due_at') like '2026-11-05%', 'срок в карточке');
reset role;
rollback;
