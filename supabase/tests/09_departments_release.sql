-- Отделы по списку заказчика, «Магазин» скрыт от мастера; сведения о последней сборке.
begin;
select pg_temp.assert((select string_agg(name, ',' order by sort) from public.departments where is_active)
  = 'Стройка,Столярка,Электротовары,Инструменты,Напольные покрытия,Плитка,Сантехника,Водоснабжение,Сад,Скобянка,Краски,Декор,Освещение,Хранение,Кухни,B2B,Склад,Служебные помещения,Сектор касс,Шатёр',
  'отделы по списку, без повторов, «Инструменты» вместо «Электроинструменты»');
select pg_temp.assert((select not is_active and not is_default from public.departments where name = 'Магазин'), '«Магазин» мастер не выбирает');
select pg_temp.assert(not exists (select 1 from public.departments where name = 'Электроинструменты'), 'старого названия нет');

select pg_temp.login_as('kolya');
select pg_temp.assert((select runtime_version from public.app_release where platform = 'android') is not null, 'мастер видит последнюю сборку');
do $$ begin
  update public.app_release set runtime_version = '99';
  if found then raise exception 'ПРОВАЛ: мастер поменял сведения о сборке'; end if;
  raise notice 'ok: сведения о сборке только для чтения';
exception when insufficient_privilege then raise notice 'ok: сведения о сборке только для чтения';
end $$;
rollback;
