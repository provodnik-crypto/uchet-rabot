-- Смена мастера: отправка, деньги на сервере, доли, видимость, правка.
create or replace function pg_temp.item(p_name text) returns bigint language sql as $$
  select id from public.price_items where full_name = p_name $$;
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where nickname = p_name or display_name = p_name $$;
create or replace function pg_temp.dep() returns smallint language sql as $$
  select id from public.departments where is_default $$;

begin;
select pg_temp.login_as('kolya');
select pg_temp.assert(
  (public.submit_shift(jsonb_build_object(
    'client_uuid', '11111111-1111-1111-1111-111111111111',
    'work_date', public.app_today(),
    'entries', jsonb_build_array(
      -- 588 ₽ × 3 шт = 1764 ₽, на троих
      jsonb_build_object('request_number', 'rfs260423_2283', 'department_id', pg_temp.dep(),
        'price_item_id', pg_temp.item('Благоустройство: Малые архитектурные формы: Установка скамеек'),
        'quantity', 3, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'), pg_temp.emp('Миша'), pg_temp.emp('Женя'))),
      jsonb_build_object('request_number', null, 'department_id', pg_temp.dep(),
        'custom_name', 'Сборка мебели для подиума', 'unit_id', (select id from public.units where code = 'шт'),
        'quantity', 2, 'note', 'срочно', 'performer_ids', jsonb_build_array(pg_temp.emp('Коля')))
    )
  )) ->> 'pending')::int = 1,
  'смена отправлена, одна работа на оценке');
select pg_temp.assert((select count(*) from public.my_entries()) = 2, 'мастер видит свои 2 работы');
select pg_temp.assert((select count(*) from public.entry_money) = 0, 'мастер не видит денег по работам');
select pg_temp.assert((select count(*) from public.performer_money) = 0, 'мастер не видит доли в рублях');
select pg_temp.assert(
  (select string_agg(status, ',' order by entry_position) from public.my_entries()) = 'priced,pending',
  'работа из прайса принята, вне прайса — на оценке');
select pg_temp.assert(
  (select request_number from public.my_entries() where entry_position = 1) = 'RFS260423_2283', 'номер заявки сохранён в верхнем регистре');
select pg_temp.assert(exists (select 1 from public.requests where number = 'RFS260423_2283'), 'заявка добавилась в справочник');
select pg_temp.assert((select number from public.my_recent_requests()) = 'RFS260423_2283', 'недавние заявки мастера');
select pg_temp.assert((select count(*) from public.my_price_items('frequent')) = 1, 'часто используемые работы');
select pg_temp.assert(
  (select performer_names from public.my_entries() where entry_position = 1) = 'Николай Х., Михаил М., Евгений Г.', 'исполнители по порядку');

-- повторная отправка того же черновика (обрыв связи) не создаёт дубль
select public.submit_shift(jsonb_build_object(
  'client_uuid', '11111111-1111-1111-1111-111111111111', 'work_date', public.app_today(),
  'entries', jsonb_build_array(jsonb_build_object('department_id', pg_temp.dep(),
    'price_item_id', pg_temp.item('Благоустройство: Малые архитектурные формы: Установка скамеек'),
    'quantity', 3, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'), pg_temp.emp('Миша'), pg_temp.emp('Женя'))))));
select pg_temp.assert((select count(*) from public.shifts) = 1, 'повторная отправка не создаёт вторую смену');
select pg_temp.assert((select count(*) from public.my_entries()) = 1, 'правка заменяет работы смены');
select pg_temp.assert((select bool_and(can_edit) from public.my_entries()), 'смену можно править в день отправки');

-- ошибки ввода
do $$ begin
  perform public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
    'entries', jsonb_build_array(jsonb_build_object('department_id', pg_temp.dep(),
      'price_item_id', pg_temp.item('Благоустройство: Малые архитектурные формы: Установка скамеек'),
      'quantity', 1.5, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'))))));
  raise exception 'ПРОВАЛ: дробные штуки';
exception when raise_exception then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: для «шт» только целый объём (%)', sqlerrm;
end $$;
do $$ begin
  perform public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today() - 2,
    'entries', jsonb_build_array(jsonb_build_object('department_id', pg_temp.dep(), 'custom_name', 'Распил МДФ',
      'unit_id', 1, 'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'))))));
  raise exception 'ПРОВАЛ: позавчерашняя смена';
exception when raise_exception then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: дата смены только сегодня или вчера';
end $$;
do $$ begin
  perform public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
    'entries', jsonb_build_array(jsonb_build_object('request_number', 'RFS123', 'department_id', pg_temp.dep(),
      'custom_name', 'Распил МДФ', 'unit_id', 1, 'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'))))));
  raise exception 'ПРОВАЛ: кривой номер заявки';
exception when raise_exception then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: неверный номер заявки отклонён';
end $$;
do $$ begin
  perform public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
    'entries', jsonb_build_array(jsonb_build_object('department_id', pg_temp.dep(),
      'price_item_id', (select id from public.price_items where is_material limit 1),
      'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Коля'))))));
  raise exception 'ПРОВАЛ: внесён материал';
exception when raise_exception then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: материал внести нельзя';
end $$;
do $$ begin
  insert into public.shifts (work_date, author_id, client_uuid) values (current_date, 1, gen_random_uuid());
  raise exception 'ПРОВАЛ: прямая запись в смены';
exception when insufficient_privilege then raise notice 'ok: мастер пишет только через submit_shift';
end $$;
select pg_temp.assert(
  (select count(*) from public.suggest_custom_names('светильник') where kind = 'price') > 0,
  'подсказки вне прайса показывают похожие позиции прайса');

-- Миша видит работу, где он исполнитель; работы Коли без него — нет
reset role;
select pg_temp.login_as('misha');
select pg_temp.assert((select count(*) from public.my_entries()) = 1, 'напарник видит работу, где он исполнитель');
select pg_temp.assert((select count(*) from public.work_entries) = 1, 'RLS: напарник видит только свою работу');
select pg_temp.assert(not (select bool_or(can_edit) from public.my_entries()), 'чужую смену напарник не правит');
do $$ begin
  perform public.submit_shift(jsonb_build_object('client_uuid', '11111111-1111-1111-1111-111111111111', 'work_date', public.app_today(),
    'entries', jsonb_build_array(jsonb_build_object('department_id', pg_temp.dep(), 'custom_name', 'Взлом',
      'unit_id', 1, 'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Миша'))))));
  raise exception 'ПРОВАЛ: чужая смена перезаписана';
exception when insufficient_privilege then raise notice 'ok: чужую смену перезаписать нельзя';
end $$;

-- руководитель: цена подставлена, доли равны полной стоимости
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert((select total_kop from public.entry_money) = 176400, 'сумма 588 ₽ × 3 = 1764 ₽ подставлена на сервере');
select pg_temp.assert((select sum(share_kop) from public.performer_money) = 176400, 'сумма долей равна полной стоимости');
select pg_temp.assert(
  (select string_agg(share_kop::text, ',' order by e.position) from public.performer_money pm
   join public.entry_performers e using (entry_id, employee_id)) = '58800,58800,58800',
  'деление поровну на троих');
rollback;

-- копейки округления — первому исполнителю
begin;
select pg_temp.login_as('boss');
select public.admin_set_price(pg_temp.item('Благоустройство: Малые архитектурные формы: Установка скамеек'), 2857);
reset role;
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
  'entries', jsonb_build_array(jsonb_build_object('department_id', pg_temp.dep(),
    'price_item_id', pg_temp.item('Благоустройство: Малые архитектурные формы: Установка скамеек'),
    'quantity', 1, 'performer_ids', jsonb_build_array(pg_temp.emp('Миша'), pg_temp.emp('Коля'), pg_temp.emp('Женя'))))));
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert(
  (select string_agg(pm.share_kop::text, ',' order by e.position) from public.performer_money pm
   join public.entry_performers e using (entry_id, employee_id)) = '953,952,952',
  '28,57 ₽ на троих: 9,53 + 9,52 + 9,52, остаток первому');
select pg_temp.assert((select unit_price_kop from public.entry_money) = 2857, 'цена берётся на дату работы (новая цена с сегодня)');
rollback;
