begin;
select pg_temp.login_as('kolya');
select pg_temp.assert((select role from public.whoami()) = 'master', 'мастер видит свою роль');
select pg_temp.assert(not public.is_manager(), 'мастер не руководитель');
select pg_temp.assert((select count(*) from public.employees) = 6, 'мастер видит список сотрудников для выбора напарников');
update public.employees set display_name = 'Взлом' where login = 'misha';
select pg_temp.assert((select display_name from public.employees where login = 'misha') = 'Миша', 'мастер не может переименовать сотрудника');
rollback;

begin;
select pg_temp.login_as('kolya');
do $$ begin
  update public.employees set role = 'manager' where login = 'kolya';
  raise exception 'ПРОВАЛ: мастер смог сменить себе роль';
exception when insufficient_privilege then raise notice 'ok: мастер не может сменить роль';
end $$;
rollback;

begin;
select pg_temp.login_as('boss');
select pg_temp.assert((select role from public.whoami()) = 'manager', 'руководитель видит свою роль');
update public.employees set display_name = 'Михаил' where login = 'misha';
select pg_temp.assert((select display_name from public.employees where login = 'misha') = 'Михаил', 'руководитель переименовывает');
do $$ begin
  update public.employees set is_active = false where login = 'misha';
  raise exception 'ПРОВАЛ: блокировка в обход функции admin-users';
exception when insufficient_privilege then raise notice 'ok: блокировка только через admin-users';
end $$;
rollback;

begin;
set local role anon;
do $$ begin
  perform * from public.employees;
  raise exception 'ПРОВАЛ: аноним читает сотрудников';
exception when insufficient_privilege then raise notice 'ok: аноним не видит сотрудников';
end $$;
rollback;

begin;
update public.employees set is_active = false where login = 'kolya';
select pg_temp.login_as('kolya');
select pg_temp.assert(not exists (select 1 from public.whoami()), 'отключённый сотрудник не проходит проверку входа');
rollback;
