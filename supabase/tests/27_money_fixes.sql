-- Этап «деньги и дубли»: повтор без дубля, зачёт работ при подрядчике/закрытии, отказ удаляет работы,
-- закрытые обходные пути (старая «Закрыть смену», исправление в принятой заявке, отправка без фото).
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.work(p_qty numeric, p_key text default null) returns jsonb language sql as $$
  select jsonb_build_object('department_id', (select id from public.departments where is_default), 'custom_name', 'Осмотр щитка',
    'unit_id', 1, 'quantity', p_qty, 'performer_ids', jsonb_build_array(public.current_employee_id()))
    || case when p_key is null then '{}'::jsonb else jsonb_build_object('client_key', p_key) end $$;
create or replace function pg_temp.photo(p_n int) returns jsonb language sql as $$
  select jsonb_build_object('path', auth.uid() || '/' || md5('m' || p_n)::uuid || '.jpg', 'thumb_path', auth.uid() || '/' || md5('m' || p_n)::uuid || '_t.jpg') $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка Ключ');
select public.create_manual_request('Заявка Подрядчик');
select public.create_manual_request('Заявка Отказ');
select public.create_manual_request('Заявка Принята');
reset role;
create temp table _r on commit drop as select id, operation from public.requests where operation like 'Заявка %';
create temp table _p on commit drop as select pi.id from public.price_items pi where pi.is_active and not pi.is_material
  and public.price_on(pi.id, public.app_today()) > 0 order by pi.id limit 1;
grant all on _r, _p to authenticated;
create or replace function pg_temp.pwork(p_qty numeric) returns jsonb language sql as $$
  select jsonb_build_object('department_id', (select id from public.departments where is_default),
    'price_item_id', (select id from _p),
    'quantity', p_qty, 'performer_ids', jsonb_build_array(public.current_employee_id())) $$;
grant execute on all functions in schema pg_temp to authenticated;
create function pg_temp.rid(p text) returns bigint language sql as $$ select id from _r where operation = 'Заявка ' || p $$;
grant execute on all functions in schema pg_temp to authenticated;

-- 1. повтор того же нажатия не создаёт дубль
select pg_temp.login_as('kolya');
select public.take_request(pg_temp.rid('Ключ'), null);
select public.add_request_work(pg_temp.rid('Ключ'), pg_temp.work(1, '11111111-1111-1111-1111-111111111111'));
select public.add_request_work(pg_temp.rid('Ключ'), pg_temp.work(1, '11111111-1111-1111-1111-111111111111'));
select pg_temp.assert((select count(*) from public.work_entries where request_id = pg_temp.rid('Ключ')) = 1, 'повтор с тем же ключом — без дубля');
select public.add_request_work(pg_temp.rid('Ключ'), pg_temp.work(2, '22222222-2222-2222-2222-222222222222'));
select pg_temp.assert((select count(*) from public.work_entries where request_id = pg_temp.rid('Ключ')) = 2, 'новая работа с новым ключом сохраняется');
-- 2. отправка без фото невозможна и напрямую
select pg_temp.assert(pg_temp.err(format('select public.send_request_for_review(%s, null)', pg_temp.rid('Ключ'))) = 'Добавьте фото результата', 'без фото — нельзя и напрямую');
-- 3. старая «Закрыть смену»: без заявки и в чужую/принятую — нельзя; «день» не переписать
select pg_temp.assert(pg_temp.err($q$select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(), 'entries', jsonb_build_array(pg_temp.pwork(1))))$q$)
  like 'Работы без заявки больше не вносятся%', 'без заявки — нельзя');
select pg_temp.assert(pg_temp.err(format($q$select public.submit_shift(jsonb_build_object('client_uuid', %L, 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.pwork(1) || jsonb_build_object('request_number', (select number from public.requests where id = pg_temp.rid('Ключ'))))))$q$,
  public.day_shift_uuid(public.current_employee_id(), public.app_today()))) like 'Эту смену уже нельзя изменить%', '«день» мастера не переписать');
-- 4. отказ: несданные работы удаляются
select public.send_request_for_review_photos(pg_temp.rid('Ключ'), null, jsonb_build_array(pg_temp.photo(1)));
select public.take_request(pg_temp.rid('Отказ'), null);
select public.add_request_work(pg_temp.rid('Отказ'), pg_temp.work(3));
select public.refuse_request(pg_temp.rid('Отказ'), 'Нет запчасти');
select pg_temp.assert((select count(*) from public.work_entries where request_id = pg_temp.rid('Отказ')) = 0, 'отказ — работы удалены');
-- 5. работа в заявку, которую потом передадут подрядчику
select public.take_request(pg_temp.rid('Подрядчик'), null);
select public.add_request_work(pg_temp.rid('Подрядчик'), pg_temp.pwork(2));
reset role;

select pg_temp.login_as('boss');
select pg_temp.assert(pg_temp.err(format('select public.settle_request_works(%s, true)', pg_temp.rid('Подрядчик'))) is null, 'руководитель решает про работы');
select pg_temp.assert((select status from public.work_entries where request_id = pg_temp.rid('Подрядчик')) = 'priced', 'засчитано — в суммах');
select public.assign_request(pg_temp.rid('Подрядчик'), null, true);
select pg_temp.assert((select status from public.work_entries where request_id = pg_temp.rid('Подрядчик')) = 'priced', 'после передачи подрядчику — остаётся засчитанной');
select public.accept_request(pg_temp.rid('Ключ'), null);
reset role;

select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err(format('select public.settle_request_works(%s, false)', pg_temp.rid('Ключ'))) is not null, 'мастеру решать про зачёт нельзя');
-- 6. в принятую заявку старой сменой — нельзя
select pg_temp.assert(pg_temp.err(format($q$select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(pg_temp.pwork(100) || jsonb_build_object('request_number', %L))))$q$, (select number from public.requests where id = pg_temp.rid('Ключ'))))
  like '%уже не в работе%', 'в принятую заявку — нельзя');
reset role;

-- 7. «не засчитывать»: работы становятся отклонёнными
select pg_temp.login_as('kolya');
select public.take_request(pg_temp.rid('Принята'), null);
select public.add_request_work(pg_temp.rid('Принята'), pg_temp.pwork(1));
reset role;
select pg_temp.login_as('boss');
select public.settle_request_works(pg_temp.rid('Принята'), false);
select pg_temp.assert((select status from public.work_entries where request_id = pg_temp.rid('Принята')) = 'rejected', 'не засчитано — отклонена');
reset role;
-- 8. отклонённую работу в заявке не «в работе» мастер не исправляет
select pg_temp.login_as('boss');
select public.set_request_open(pg_temp.rid('Принята'), false);
reset role;
select pg_temp.login_as('kolya');
select pg_temp.assert(pg_temp.err(format('select public.resubmit_entry(%s, null, null, 50, null, (select pi.id from public.price_items pi where pi.is_active and not pi.is_material order by pi.id limit 1), null)',
  (select id from public.work_entries where request_id = pg_temp.rid('Принята')))) like 'Заявка уже не у вас в работе%', 'исправить в чужой/закрытой заявке — нельзя');
reset role;
rollback;
