-- Карточка заявки, счётчики на главной мастера, названия-обрывки в прайсе. Данные выдуманные.
begin;
-- Переименования прайса проверяются на рабочей базе: в тестах прайс загружается после миграций.
select pg_temp.login_as('boss');
select public.request_import_apply($j${"rows": [
  {"number": "RFS261013_0001", "store_code": "031", "operation": "Другие работы",
   "description": "Повесить плакат.\nСрочно", "registered_at": "2026-10-13 09:00:00", "requester": "Пётр Т. (60000001)"},
  {"number": "RFS261013_0002", "store_code": "031", "operation": "Ремонт стульев", "registered_at": "2026-10-13 10:00:00"}
], "file_rows": 2}$j$::jsonb);
select public.assign_request((select id from public.requests where number = 'RFS261013_0001'),
                             (select id from public.employees where login = 'kolya'), false);
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert((public.request_card(null, 'RFS261013_0001') ->> 'description') = E'Повесить плакат.\nСрочно', 'карточка: полное описание с переносом строки');
select pg_temp.assert((public.request_card(null, 'RFS261013_0001') ->> 'requester_name') = 'Пётр Т.', 'карточка: заявитель без номера');
select pg_temp.assert((public.request_card(null, 'RFS261013_0001') ->> 'mine')::boolean, 'карточка: назначена мне');
select pg_temp.assert(not (public.request_card(null, 'RFS261013_0001') ? 'requester'), 'номер заявителя мастеру не отдаётся');
select pg_temp.assert(jsonb_typeof(public.request_card(null, 'RFS261013_0001') -> 'works') = 'array', 'карточка: список работ');
select pg_temp.assert(public.request_card(null, 'RFS000000_0000') is null, 'нет такой заявки — пусто');
select pg_temp.assert((select assigned from public.my_requests_badge(null)) = 1, 'назначено мне: 1');
select pg_temp.assert((select fresh from public.my_requests_badge(null)) = 0, 'без отметки просмотра новых нет');
select pg_temp.assert((select fresh from public.my_requests_badge(now() - interval '1 hour')) >= 2, 'новые после просмотра');
select pg_temp.assert((select fresh from public.my_requests_badge(now() + interval '1 hour')) = 0, 'после просмотра счётчик сбрасывается');
reset role;
rollback;
