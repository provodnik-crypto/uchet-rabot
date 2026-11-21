-- Закрыть старые заявки пачкой; фильтр «Открытые / Закрытые / Все». Номера выдуманные.
begin;
select pg_temp.login_as('boss');
select public.request_import_apply($j${"rows": [
  {"number": "RFS250101_0001", "store_code": "031", "operation": "Другие работы", "registered_at": "2025-01-01 10:00:00"},
  {"number": "RFS260801_0002", "store_code": "031", "operation": "Другие работы", "registered_at": "2026-08-01 10:00:00"},
  {"number": "RFS261010_0003", "store_code": "031", "operation": "Другие работы", "registered_at": "2026-10-10 10:00:00"}
], "file_rows": 3}$j$::jsonb);
select pg_temp.assert((select count(*) from public.old_open_requests('2026-09-13')) = 2, 'предпросмотр: две старше 13.09.2026');
select pg_temp.assert(public.close_old_requests('2026-09-13') = 2, 'закрыты две');
select pg_temp.assert((select is_open from public.requests where number = 'RFS261010_0003'), 'свежая осталась открытой');
select pg_temp.assert((select count(*) from public.old_open_requests('2026-09-13')) = 0, 'старых открытых больше нет');
select pg_temp.assert((select count(*) from public.list_requests('', 100, 'closed') where number like 'RFS2%') = 2, 'фильтр «Закрытые»');
select pg_temp.assert(not exists (select 1 from public.list_requests('', 100, 'open') where not is_open), 'фильтр «Открытые»');
select pg_temp.assert((select count(*) from public.list_requests('RFS2', 100)) >= 3, 'без фильтра — все (старые версии приложения)');
do $$ begin
  perform public.close_old_requests(public.store_today() + 1);
  raise exception 'ПРОВАЛ: дата в будущем';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: дату в будущем не принять';
end $$;
reset role;
select pg_temp.login_as('kolya');
do $$ begin
  perform public.close_old_requests('2026-09-13');
  raise exception 'ПРОВАЛ: мастер закрыл пачкой';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: мастер не закрывает пачкой';
end $$;
reset role;
rollback;
