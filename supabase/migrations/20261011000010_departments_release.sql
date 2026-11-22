-- Отделы магазина, где бывают ремонтные работы (список заказчика от 11.10.2026),
-- и сведения о последней сборке приложения для полосы «Установите новую версию».

-- ---------- Отделы ----------
-- «Электроинструменты» теперь просто «Инструменты» (точное имя: lower() зависит от локали).
update public.departments set name = 'Инструменты' where trim(name) = 'Электроинструменты';

-- «Магазин» мастер больше не выбирает: в фильтрах руководителя он означает «весь магазин».
-- Старые записи с отделом «Магазин» остаются как есть.
update public.departments set is_default = false, is_active = false where trim(name) in ('Магазин', 'магазин');

insert into public.departments (name, sort)
select name, sort from (values
  ('Стройка', 1), ('Столярка', 2), ('Электротовары', 3), ('Инструменты', 4), ('Напольные покрытия', 5),
  ('Плитка', 6), ('Сантехника', 7), ('Водоснабжение', 8), ('Сад', 9), ('Скобянка', 10), ('Краски', 11),
  ('Декор', 12), ('Освещение', 13), ('Хранение', 14), ('Кухни', 15), ('B2B', 16), ('Склад', 17),
  ('Служебные помещения', 18), ('Сектор касс', 19), ('Шатёр', 20)
) as v(name, sort)
on conflict ((public.normalize_search(trim(name)))) do nothing;

-- Порядок как в списке заказчика; уже существующие отделы тоже включаются (точные имена — без lower()).
update public.departments d set sort = v.sort, is_active = true
from (values
  ('Стройка', 1), ('Столярка', 2), ('Электротовары', 3), ('Инструменты', 4), ('Напольные покрытия', 5),
  ('Плитка', 6), ('Сантехника', 7), ('Водоснабжение', 8), ('Сад', 9), ('Скобянка', 10), ('Краски', 11),
  ('Декор', 12), ('Освещение', 13), ('Хранение', 14), ('Кухни', 15), ('B2B', 16), ('Склад', 17),
  ('Служебные помещения', 18), ('Сектор касс', 19), ('Шатёр', 20)
) as v(name, sort)
where trim(d.name) = v.name;

-- Если отделом по умолчанию был «Магазин» — по умолчанию первый по списку.
update public.departments set is_default = true
where id = (select id from public.departments where is_active order by sort, id limit 1)
  and not exists (select 1 from public.departments where is_default);

-- ---------- Последняя сборка приложения ----------
-- Приложение сравнивает свою версию среды (runtimeVersion) с этой строкой; если отстаёт —
-- показывает полосу со ссылкой на новый APK. После каждой новой сборки обновить строку.
create table public.app_release (
  platform         text primary key check (platform in ('android')),
  runtime_version  text not null,
  apk_url          text not null check (apk_url like 'https://%'),
  updated_at       timestamptz not null default now()
);
alter table public.app_release enable row level security;
create policy app_release_read on public.app_release for select to anon, authenticated using (true);
grant select on public.app_release to anon, authenticated;

insert into public.app_release (platform, runtime_version, apk_url) values
  ('android', '2', 'https://expo.dev/artifacts/eas/p350l267n5MyOWIOX6ap4cSJ3--6T7kXVodgQalobrU.apk');
