-- Один путь мастера: работы только в своей заявке и сразу на сервер; отправка с фото; сообщения руководителю.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.work(p_qty numeric) returns jsonb language sql as $$
  select jsonb_build_object('department_id', (select id from public.departments where is_default), 'custom_name', 'Осмотр щитка',
    'unit_id', 1, 'quantity', p_qty, 'performer_ids', jsonb_build_array(public.current_employee_id())) $$;
-- фото в папке пользователя (в тестовой базе хранилища нет — проверяется только путь)
create or replace function pg_temp.photo(p_n int) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid() || '/' || md5('p' || p_n)::uuid || '.jpg', 'thumb_path', auth.uid() || '/' || md5('p' || p_n)::uuid || '_t.jpg') $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Проверить щиток');
reset role;
create temp table _r on commit drop as select id from public.requests where operation = 'Проверить щиток';
create temp table _w (id bigint);
grant all on _r, _w to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err(format('select public.add_request_work(%s, pg_temp.work(1))', (select id from _r))) = 'Работы вносит мастер, у которого заявка «В работе»',
  'в чужую/не взятую заявку работу не внести');
select public.take_request((select id from _r), null);
insert into _w select public.add_request_work((select id from _r), pg_temp.work(2));
select pg_temp.assert((select s.work_date = public.app_today() and s.client_uuid = public.day_shift_uuid(public.current_employee_id(), public.app_today())
  from public.work_entries w join public.shifts s on s.id = w.shift_id where w.id = (select id from _w)), 'работа сохранена сразу, датой внесения, в «день» мастера');
select pg_temp.assert((select (x ->> 'can_edit')::boolean from jsonb_array_elements(public.request_card((select id from _r)) -> 'works') x), 'в карточке: можно исправить');
-- исправить: замена
update _w set id = public.add_request_work((select id from _r), pg_temp.work(3), (select id from _w));
select pg_temp.assert((select quantity from public.work_entries where id = (select id from _w)) = 3 and (select count(*) from public.work_entries where request_id = (select id from _r)) = 1,
  'исправление заменяет работу, не задваивает');
-- вторая работа и удаление
insert into _w select public.add_request_work((select id from _r), pg_temp.work(1));
select public.delete_my_work((select max(id) from _w));
select pg_temp.assert((select count(*) from public.work_entries where request_id = (select id from _r)) = 1, 'удалить свою работу можно');
-- отправка: без фото нельзя, с фото — да; после отправки менять нельзя
select pg_temp.assert(pg_temp.err(format($q$select public.send_request_for_review_photos(%s, null, '[]')$q$, (select id from _r))) = 'Добавьте фото результата', 'без фото результата не отправить');
select public.send_request_for_review_photos((select id from _r), 'Готово', jsonb_build_array(pg_temp.photo(1), pg_temp.photo(2)));
select pg_temp.assert((select status from public.requests where id = (select id from _r)) = 'review', 'отправлена на проверку');
select pg_temp.assert(jsonb_array_length(public.request_card((select id from _r)) -> 'result_photos') = 2, 'фото результата в карточке');
select pg_temp.assert(pg_temp.err(format('select public.delete_my_work(%s)', (select min(id) from _w))) = 'Эту работу уже нельзя удалить', 'после отправки — только руководитель');
-- создать заявку мастер не может; плановая работа — одна за раз, по общей нумерации
select pg_temp.assert(pg_temp.err($q$select public.create_manual_request('Хочу заявку')$q$) like 'Создавать заявки может только руководитель%', 'мастер не создаёт заявки');
select pg_temp.assert(pg_temp.err($q$select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.work(1) || jsonb_build_object('request_number', 'RFS261023_' || '9999')))))$q$) is not null and not exists (select 1 from public.requests where number = 'RFS261023_' || '9999'), 'номер вручную не заводит заявку');
-- сообщение руководителю
select public.create_master_report('Течёт кран в подсобке', jsonb_build_array(pg_temp.photo(3)));
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert((public.my_notifications() ->> 'reports')::int = 1, 'руководителю: 1 новое сообщение');
select pg_temp.assert(jsonb_array_length(public.list_master_reports() -> 0 -> 'photos') = 1, 'сообщение с фото');
select public.decide_master_report((public.list_master_reports() -> 0 ->> 'id')::bigint, 'read');
select pg_temp.assert((public.my_notifications() ->> 'reports')::int = 0, 'открыл — прочитано');
select public.decide_master_report((public.list_master_reports() -> 0 ->> 'id')::bigint, 'request', null, 'Починить кран');
select pg_temp.assert((select status || ' ' || operation from public.requests where id = (public.list_master_reports() -> 0 ->> 'request_id')::bigint) = 'waiting Починить кран',
  'по сообщению создана заявка');
-- дату работы меняет руководитель
select public.admin_set_entry_date((select min(id) from _w), public.app_today() - 3);
select pg_temp.assert((select s.work_date from public.work_entries w join public.shifts s on s.id = w.shift_id where w.id = (select min(id) from _w)) = public.app_today() - 3,
  'руководитель сменил дату работы');
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert((public.my_master_reports() -> 0 ->> 'status') = 'request' and (public.my_master_reports() -> 0 ->> 'unseen')::boolean, 'мастер видит: создана заявка');
select public.mark_my_reports_seen();
select pg_temp.assert(not (public.my_master_reports() -> 0 ->> 'unseen')::boolean, 'ответ просмотрен');
reset role;
-- ночная чистка не трогает фото результата и сообщений
insert into public.photo_trash (path) select path from public.extra_photos limit 1;
select pg_temp.assert(not exists (select 1 from public.photo_cleanup_batch(100) p where p in (select path from public.extra_photos)), 'чистка фото не удаляет фото результата');
rollback;
