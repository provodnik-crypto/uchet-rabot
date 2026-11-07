-- Фото из файла ITSM и рабочий телефон инициатора.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

begin;
insert into public.requests (number, source, store_id, operation, registered_at)
  values ('RFS261023_0001', 'itsm', public.default_store_id(), 'Ручки в шоуруме', now()),
         ('RFS261023_0002', 'itsm', public.default_store_id(), 'МДФ щит', now());
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err($$select public.attach_request_photos('RFS261023_0001', '[]')$$) is not null, 'мастер фото к заявке не добавляет');
select pg_temp.assert(pg_temp.err($$select public.set_request_phones('[{"number":"RFS261023_0001","phone":"031323"}]')$$) is not null, 'мастер телефон не записывает');
reset role;

select pg_temp.login_as('boss');
create temp table _ph on commit drop as select
  auth.uid()::text || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg' p, auth.uid()::text || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa_t.jpg' t;
select pg_temp.assert(public.attach_request_photos('RFS261023_0001',
  (select jsonb_build_array(jsonb_build_object('path', p, 'thumb_path', t)) from _ph)) = 1, 'руководитель добавил фото к заявке');
select pg_temp.assert(public.attach_request_photos('RFS261023_0001',
  jsonb_build_array(jsonb_build_object('path', auth.uid()::text || '/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg',
                                       'thumb_path', auth.uid()::text || '/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb_t.jpg'))) = 0,
  'повторная загрузка файла фото не дублирует');
select pg_temp.assert(public.requests_with_photos(array['RFS261023_0001', 'RFS261023_0002']) = array['RFS261023_0001'], 'видно, у каких заявок фото уже есть');
select pg_temp.assert(public.set_request_phones('[{"number":"RFS261023_0001","phone":"031323"},{"number":"RFS261023_0002","phone":"89000000000"}]') = 1,
  'записан только рабочий номер 031xxx');
select pg_temp.assert(public.set_request_phones('[{"number":"RFS261023_0001","phone":"031999"}]') = 0, 'уже записанный телефон не перезаписывается');
reset role;
select pg_temp.assert(pg_temp.err($$update public.requests set contact_phone = '89000000000' where number = 'RFS261023_0002'$$) is not null,
  'в базе — только 031xxx');

select pg_temp.login_as('kolya');
select pg_temp.assert((public.request_extras((select id from public.requests where number = 'RFS261023_0001')) ->> 'contact_phone') = '031323',
  'мастер видит рабочий телефон');
select pg_temp.assert(jsonb_array_length(public.request_extras((select id from public.requests where number = 'RFS261023_0001')) -> 'photos') = 1,
  'мастер видит фото заявки');
select pg_temp.assert((select id from public.requests where number = 'RFS261023_0001') = any (public.request_photo_ids()), 'значок 📷 в списке');
select pg_temp.assert(public.can_see_extra_photo((select p from _ph)), 'мастер может открыть файл фото заявки');
reset role;
-- фото результата мастеру по-прежнему закрыто
insert into public.extra_photos (owner_kind, owner_id, position, path, thumb_path)
  values ('result', 1, 1, 'x/cccccccc-cccc-cccc-cccc-cccccccccccc.jpg', 'x/cccccccc-cccc-cccc-cccc-cccccccccccc_t.jpg');
select pg_temp.login_as('kolya');
select pg_temp.assert(not public.can_see_extra_photo('x/cccccccc-cccc-cccc-cccc-cccccccccccc.jpg'), 'чужие фото результата мастеру закрыты, как раньше');
reset role;
rollback;
