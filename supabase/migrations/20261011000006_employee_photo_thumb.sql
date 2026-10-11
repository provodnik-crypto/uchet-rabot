-- Маленькое фото (data:image/jpeg;base64, ~5 КБ) прямо в записи сотрудника:
-- приходит вместе со списком сотрудников, без отдельной загрузки картинки из хранилища.
alter table public.employees
  add column photo_thumb text check (photo_thumb is null or (photo_thumb like 'data:image/%' and length(photo_thumb) < 40000));
grant select (photo_thumb) on public.employees to authenticated;
