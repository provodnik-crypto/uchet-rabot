-- Название заявки и фото к заявке из карточки.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.ph(p_n text) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid()::text || '/' || p_n || '.jpg', 'thumb_path', auth.uid()::text || '/' || p_n || '_t.jpg')
$$;

begin;
insert into public.requests (number, source, store_id, operation, subject, registered_at)
  values ('RFS261104_0001', 'itsm', public.default_store_id(), 'Ручки в шоуруме', 'Ручки в шоуруме', now());
create temp table _r on commit drop as select id from public.requests where number = 'RFS261104_0001';
grant select on _r to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- Название ----------
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err($$select public.set_request_title((select id from _r), 'Новое')$$) is not null,
  'мастер не меняет название чужой (ITSM) заявки');
create temp table _p on commit drop as select (public.start_planned_work('Подтянуть стеллаж') ->> 'id')::bigint id;
select pg_temp.assert((public.request_card((select id from _p)) ->> 'can_edit_title')::boolean, 'мастер может менять название своей заявки');
select public.set_request_title((select id from _p), '  Подтянуть   стеллаж,  зал 2 ');
select pg_temp.assert((select operation from public.requests where id = (select id from _p)) = 'Подтянуть стеллаж, зал 2',
  'лишние пробелы обрезаны');
select pg_temp.assert(pg_temp.err($$select public.set_request_title((select id from _p), '   ')$$) like '%пустым%', 'пустое название — отказ');
reset role;
update public.requests set status = 'review', sent_at = now() where id = (select id from _p);
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err($$select public.set_request_title((select id from _p), 'Ещё раз')$$) is not null,
  'после отправки на проверку мастер название не меняет');
reset role;

select pg_temp.login_as('boss');
select public.set_request_title((select id from _r), 'Ручки на дверях шоурума');
reset role;
select pg_temp.assert((select operation = 'Ручки на дверях шоурума' and subject = 'Ручки на дверях шоурума' and title_edited_at is not null
                         and title_edited_by = (select id from public.employees where login = 'boss') from public.requests where id = (select id from _r)),
  'руководитель изменил название, записано кто и когда');
select pg_temp.login_as('boss');
select public.set_request_title((select id from _p), 'Стеллаж, зал 2');
select pg_temp.assert((select operation from public.requests where id = (select id from _p)) = 'Стеллаж, зал 2', 'руководитель — у любой заявки');
-- повторная загрузка файла с тем же номером и старым названием
select public.request_import_apply(jsonb_build_object('rows', jsonb_build_array(jsonb_build_object(
  'number', 'RFS261104_0001', 'store_code', '031', 'operation', 'Ручки в шоуруме', 'description', 'x', 'registered_at', now()::text))));
select pg_temp.assert((select operation from public.requests where id = (select id from _r)) = 'Ручки на дверях шоурума',
  'повторная загрузка файла ITSM название не перезаписывает');

-- ---------- Фото ----------
select pg_temp.assert(public.add_request_photos((select id from _r), jsonb_build_array(
  pg_temp.ph('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), pg_temp.ph('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))) = 2,
  'руководитель добавил 2 фото к заявке без фото');
select pg_temp.assert(public.add_request_photos((select id from _r), jsonb_build_array(pg_temp.ph('cccccccc-cccc-cccc-cccc-cccccccccccc'))) = 3,
  'новые фото добавились к имеющимся');
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert(jsonb_array_length(public.request_extras((select id from _r)) -> 'photos') = 3, 'мастер видит фото заявки');
select pg_temp.assert(not (public.request_extras((select id from _r)) ->> 'can_add')::boolean, 'мастер без заявки в работе фото не добавляет');
select pg_temp.assert(pg_temp.err($$select public.add_request_photos((select id from _r), jsonb_build_array(pg_temp.ph('dddddddd-dddd-dddd-dddd-dddddddddddd')))$$) is not null,
  'чужая заявка — отказ');
select pg_temp.assert(pg_temp.err($$select public.delete_request_photo((public.request_extras((select id from _r)) -> 'photos' -> 0 ->> 'id')::bigint)$$) is not null,
  'чужое фото мастер не удаляет');
select public.take_request((select id from _r), null, '{}');
select pg_temp.assert((public.request_extras((select id from _r)) ->> 'can_add')::boolean, 'взял в работу — может добавить');
select pg_temp.assert(public.add_request_photos((select id from _r), jsonb_build_array(pg_temp.ph('dddddddd-dddd-dddd-dddd-dddddddddddd'))) = 4,
  'мастер добавил фото к своей заявке в работе');
select pg_temp.assert((public.request_extras((select id from _r)) -> 'photos' -> 3 ->> 'can_delete')::boolean
                      and not (public.request_extras((select id from _r)) -> 'photos' -> 0 ->> 'can_delete')::boolean,
  'удалить можно только своё');
select public.delete_request_photo((public.request_extras((select id from _r)) -> 'photos' -> 3 ->> 'id')::bigint);
select pg_temp.assert(jsonb_array_length(public.request_extras((select id from _r)) -> 'photos') = 3, 'мастер удалил своё фото');
reset role;
select pg_temp.assert(exists (select 1 from public.photo_trash where path like '%dddddddd-dddd-dddd-dddd-dddddddddddd.jpg'), 'файл уйдёт в ночную чистку');

select pg_temp.login_as('boss');
select public.delete_request_photo((public.request_extras((select id from _r)) -> 'photos' -> 0 ->> 'id')::bigint);
select pg_temp.assert(jsonb_array_length(public.request_extras((select id from _r)) -> 'photos') = 2, 'руководитель удаляет любое фото');
reset role;
rollback;
