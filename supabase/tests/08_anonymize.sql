-- Обезличивание: имя + буква фамилии, номер для одинаковых, значки, в заявке только номер и тема.
begin;
select pg_temp.assert((select string_agg(display_name, ',' order by id) from public.employees where role = 'master')
  = 'Николай Х.,Михаил М.,Евгений Г.,Владимир К.', 'мастера записаны как «Имя Ф.»');
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employees'
  and column_name in ('nickname', 'photo_path', 'photo_thumb')), 'полей с фото и короткими именами больше нет');
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'requests'
  and column_name not in ('id', 'number', 'subject', 'created_by', 'created_at')), 'у заявки только номер и тема');
select pg_temp.assert((select count(distinct icon) from public.employees where role = 'master') = 4, 'значки у мастеров не повторяются');
select pg_temp.assert((select icon from public.employees where role = 'service') is null, 'служебному значок не нужен');

insert into public.employees (first_name, last_initial) values ('иван', 'п');
insert into public.employees (first_name, last_initial) values ('Иван', 'П');
select pg_temp.assert((select string_agg(display_name, ',' order by id) from public.employees where first_name = 'Иван')
  = 'Иван П.,Иван П. 2', 'одинаковые получают номер, регистр выравнивается');
select pg_temp.assert((select count(distinct icon) from public.employees where is_active and role <> 'service')
  = (select count(*) from public.employees where is_active and role <> 'service'), 'пока есть свободные значки — не повторяются');

do $$ begin
  insert into public.employees (first_name, last_initial) values ('Пётр', 'Ив');
  raise exception 'ПРОВАЛ: две буквы фамилии';
exception when check_violation then raise notice 'ok: в фамилии только одна буква';
end $$;
do $$ begin
  insert into public.employees (first_name) values ('Пётр Иванов');
  raise exception 'ПРОВАЛ: фамилия в поле имени';
exception when check_violation then raise notice 'ok: в поле имени нельзя ввести имя с фамилией';
end $$;

-- руководитель меняет имя, букву и значок; display_name собирается сам
select pg_temp.login_as('boss');
update public.employees set first_name = 'Ваня', icon = 12 where display_name = 'Иван П. 2';
select pg_temp.assert(exists (select 1 from public.employees where display_name = 'Ваня П.' and icon = 12), 'руководитель меняет имя и значок');
do $$ begin
  update public.employees set display_name = 'Иван Петров' where display_name = 'Ваня П.';
  raise exception 'ПРОВАЛ: display_name можно записать напрямую';
exception when insufficient_privilege then raise notice 'ok: полное имя напрямую не записать';
end $$;
reset role;

create temp table _icon as select icon from public.employees where login = 'misha';
grant select on _icon to authenticated;
select pg_temp.login_as('kolya');
update public.employees set icon = case when icon = 1 then 2 else 1 end where login = 'misha';
select pg_temp.assert((select icon from public.employees where login = 'misha') = (select icon from _icon), 'мастер не меняет значки');
reset role;
rollback;
