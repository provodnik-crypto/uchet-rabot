-- Прайс загружен целиком, мастер видит только доступные ему работы и не видит цен.
begin;
select pg_temp.assert((select count(*) from public.price_items) = 2907, 'загружены все 2907 строк прайса');
select pg_temp.assert((select count(*) from public.price_item_prices) = 2907, 'у каждой позиции есть цена');
select pg_temp.assert((select count(*) from public.price_items where is_material and is_active) = 0, 'материалы хранятся выключенными');
select pg_temp.assert(
  (select price_kop from public.price_item_prices pp join public.price_items p on p.id = pp.price_item_id where p.source_id = 1) = 2857,
  'цена 28.57 ₽ хранится как 2857 копеек');
rollback;

begin;
select pg_temp.login_as('kolya');
select pg_temp.assert((select count(*) from public.price_items) = 1399, 'мастер видит 1399 работ (активные, не материалы)');
select pg_temp.assert((select count(*) from public.price_item_prices) = 0, 'мастер не видит ни одной цены');
select pg_temp.assert((select count(*) from public.price_lists) = 0, 'мастер не видит версии прайса');
select pg_temp.assert((select count(*) from public.search_price_items('розетк')) > 0, 'поиск по части слова находит работы');
select pg_temp.assert(
  (select bool_and(public.normalize_search(short_name || ' ' || category || ' ' || coalesce(subcategory, '')) like '%светильник%')
   from public.search_price_items('светильник')) is not false,
  'найденные работы содержат слово запроса');
select pg_temp.assert(
  (select count(*) from public.search_price_items('монтаж светильник')) <= (select count(*) from public.search_price_items('светильник')),
  'несколько слов сужают поиск');
select pg_temp.assert(
  (select count(*) from public.search_price_items('ЁЛКА')) = (select count(*) from public.search_price_items('елка')),
  'поиск не различает регистр и ё/е');
select pg_temp.assert((select sum(items) from public.price_categories()) = 1399, 'категории покрывают все доступные работы');
select pg_temp.assert(
  (select count(*) from public.search_price_items('', 'Благоустройство', null, 200)) =
  (select sum(items) from public.price_categories() where category = 'Благоустройство'),
  'фильтр по категории');
do $$ begin
  perform public.price_on(1, current_date);
  raise exception 'ПРОВАЛ: мастер вызвал price_on';
exception when insufficient_privilege then raise notice 'ok: мастер не может узнать цену через price_on';
end $$;
do $$ begin
  perform * from public.admin_price_items();
  raise exception 'ПРОВАЛ: мастер открыл прайс руководителя';
exception when insufficient_privilege then raise notice 'ok: мастер не открывает прайс с ценами';
end $$;
do $$ begin
  perform public.admin_set_price(1, 100);
  raise exception 'ПРОВАЛ: мастер поменял цену';
exception when insufficient_privilege then raise notice 'ok: мастер не меняет цены';
end $$;
update public.price_items set is_active = false;
select pg_temp.assert((select count(*) from public.price_items) = 1399, 'мастер не может выключить позиции прайса');
do $$ begin
  insert into public.departments (name) values ('Склад');
  raise exception 'ПРОВАЛ: мастер добавил отдел';
exception when insufficient_privilege then raise notice 'ok: мастер не добавляет отделы';
end $$;
select pg_temp.assert((select count(*) from public.departments where is_active) = 20, 'мастер видит 20 отделов');
rollback;

-- Руководитель: цены, история, правка позиций и отделов.
begin;
select pg_temp.login_as('boss');
select pg_temp.assert((select count(*) from public.price_items) = 2907, 'руководитель видит весь прайс');
select pg_temp.assert((select max(total) from public.admin_price_items('', 'active')) = 1399, 'фильтр «активные» в прайсе руководителя');
select pg_temp.assert((select max(total) from public.admin_price_items('', 'all')) = 2907, 'фильтр «все»');
select pg_temp.assert((select price_kop from public.admin_price_items('скамеек', 'all') where full_name = 'Установка скамеек') = 80000, 'руководитель видит цену');

select public.admin_set_price((select id from public.price_items where full_name = 'Установка скамеек'), 95000, public.app_today() + 10);
select pg_temp.assert(
  (select price_kop from public.admin_price_items('скамеек', 'all') where full_name = 'Установка скамеек') = 80000,
  'цена с будущей даты пока не действует');
select public.admin_set_price((select id from public.price_items where full_name = 'Установка скамеек'), 90000);
select pg_temp.assert(
  (select price_kop from public.admin_price_items('скамеек', 'all') where full_name = 'Установка скамеек') = 90000,
  'новая цена действует с сегодняшнего дня');
select pg_temp.assert(
  (select count(*) from public.price_item_prices where price_item_id = (select id from public.price_items where full_name = 'Установка скамеек')) = 3,
  'старые цены сохраняются в истории');
do $$ begin
  perform public.admin_set_price(1, 0);
  raise exception 'ПРОВАЛ: нулевая цена';
exception when raise_exception then raise notice 'ok: цена должна быть больше нуля';
end $$;

update public.price_items set is_active = true where full_name = 'Установка скамеек';
select pg_temp.assert((select is_active from public.price_items where full_name = 'Установка скамеек'), 'руководитель включает позицию');

insert into public.departments (name) values ('Мебель');
do $$ begin
  insert into public.departments (name) values ('  мебель ');
  raise exception 'ПРОВАЛ: дубль отдела';
exception when unique_violation then raise notice 'ok: «Мебель» и «мебель» — один отдел';
end $$;
select public.set_default_department((select id from public.departments where name = 'Плитка'));
select pg_temp.assert((select string_agg(name, ',') from public.departments where is_default) = 'Плитка', 'отдел по умолчанию один');
do $$ begin
  update public.departments set is_active = false where name = 'Плитка';
  raise exception 'ПРОВАЛ: выключен отдел по умолчанию';
exception when check_violation then raise notice 'ok: отдел по умолчанию нельзя выключить';
end $$;
rollback;

begin;
set local role anon;
do $$ begin
  perform * from public.price_items;
  raise exception 'ПРОВАЛ: аноним читает прайс';
exception when insufficient_privilege then raise notice 'ok: аноним не видит прайс';
end $$;
rollback;
