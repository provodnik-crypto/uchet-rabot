-- Вход под пользователем: как PostgREST подставляет токен.
create or replace function pg_temp.login_as(p_login text) returns void language plpgsql as $$
declare uid uuid;
begin
  select user_id into uid from public.employees where login = p_login;
  if uid is null then raise exception 'нет пользователя %', p_login; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

-- Тестовые учётки: руководитель «boss» и мастер «kolya».
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'boss@uchet.local'),
  ('00000000-0000-0000-0000-000000000001', 'kolya@uchet.local'),
  ('00000000-0000-0000-0000-000000000002', 'misha@uchet.local')
on conflict do nothing;
insert into public.employees (display_name, role, user_id, login)
  select 'Начальник', 'manager', '00000000-0000-0000-0000-00000000000b', 'boss'
  where not exists (select 1 from public.employees where login = 'boss');
update public.employees set user_id = '00000000-0000-0000-0000-000000000001', login = 'kolya' where nickname = 'Коля';
update public.employees set user_id = '00000000-0000-0000-0000-000000000002', login = 'misha' where nickname = 'Миша';
