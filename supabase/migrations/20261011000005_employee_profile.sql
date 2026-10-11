-- Фамилии и фото сотрудников.
-- nickname — короткое имя, как его писали в старом файле («Коля»): по нему импорт истории узнаёт мастера.
alter table public.employees
  add column nickname text check (nickname is null or length(trim(nickname)) between 1 and 30),
  add column photo_path text;

update public.employees set nickname = display_name
 where role = 'master' and display_name in ('Коля', 'Миша', 'Женя', 'Володя') and nickname is null;
update public.employees set display_name = 'Николай Х.' where nickname = 'Коля';
update public.employees set display_name = 'Михаил М.' where nickname = 'Миша';
update public.employees set display_name = 'Евгений Г.' where nickname = 'Женя';
update public.employees set display_name = 'Владимир К.' where nickname = 'Володя';

grant select (nickname, photo_path) on public.employees to authenticated;

-- Фото лежат в закрытом хранилище: видят только вошедшие сотрудники (ссылки с ограниченным сроком).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('employee-photos', 'employee-photos', false)
    on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'employee_photos_read') then
      create policy employee_photos_read on storage.objects for select to authenticated
        using (bucket_id = 'employee-photos');
    end if;
  end if;
end $$;
