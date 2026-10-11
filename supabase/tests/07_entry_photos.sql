-- Фото к работам: прикрепление, лимит, чужие файлы, видимость, корзина при удалении и замене.
create or replace function pg_temp.emp(p_name text) returns bigint language sql as $$
  select id from public.employees where first_name = p_name or display_name = p_name $$;
-- путь фото в папке пользователя: <uid>/<uuid>.jpg
create or replace function pg_temp.ph(p_uid text, n int) returns jsonb language sql as $$
  select jsonb_build_object('path', p_uid || '/' || lpad(n::text, 8, '0') || '-0000-4000-8000-000000000000.jpg',
                            'thumb_path', p_uid || '/' || lpad(n::text, 8, '0') || '-0000-4000-8000-000000000000_t.jpg',
                            'width', 1600, 'height', 1200, 'size_bytes', 350000) $$;

begin;
select pg_temp.login_as('kolya');
select public.submit_shift(jsonb_build_object('client_uuid', '22222222-2222-2222-2222-222222222222', 'work_date', public.app_today(),
  'entries', jsonb_build_array(
    jsonb_build_object('department_id', 1, 'custom_name', 'Распил МДФ', 'unit_id', 1, 'quantity', 1,
      'performer_ids', jsonb_build_array(pg_temp.emp('Николай'), pg_temp.emp('Михаил')),
      'photos', jsonb_build_array(pg_temp.ph('00000000-0000-0000-0000-000000000001', 1), pg_temp.ph('00000000-0000-0000-0000-000000000001', 2))),
    jsonb_build_object('department_id', 1, 'custom_name', 'Сборка стеллажа', 'unit_id', 1, 'quantity', 1,
      'performer_ids', jsonb_build_array(pg_temp.emp('Николай'))))));
select pg_temp.assert((select count(*) from public.entry_photos) = 2, 'к работе прикреплены 2 фото');
select pg_temp.assert(
  (select count(*) from public.entry_photos_for(array(select id from public.work_entries))) = 2, 'автор видит свои фото');

-- повторная отправка той же смены (обрыв связи) — фото на месте, в корзину не попали
select public.submit_shift(jsonb_build_object('client_uuid', '22222222-2222-2222-2222-222222222222', 'work_date', public.app_today(),
  'entries', jsonb_build_array(
    jsonb_build_object('department_id', 1, 'custom_name', 'Распил МДФ', 'unit_id', 1, 'quantity', 1,
      'performer_ids', jsonb_build_array(pg_temp.emp('Николай'), pg_temp.emp('Михаил')),
      'photos', jsonb_build_array(pg_temp.ph('00000000-0000-0000-0000-000000000001', 1), pg_temp.ph('00000000-0000-0000-0000-000000000001', 2))),
    jsonb_build_object('department_id', 1, 'custom_name', 'Сборка стеллажа', 'unit_id', 1, 'quantity', 1,
      'performer_ids', jsonb_build_array(pg_temp.emp('Николай'))))));
select pg_temp.assert((select count(*) from public.entry_photos) = 2, 'после повторной отправки фото те же');
reset role;
select pg_temp.assert(not exists (select 1 from public.photo_cleanup_batch()), 'повторная отправка не отправила фото в корзину');

-- чужие файлы и лимит
select pg_temp.login_as('kolya');
do $$ begin
  perform public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
    'entries', jsonb_build_array(jsonb_build_object('department_id', 1, 'custom_name', 'Чужое фото', 'unit_id', 1, 'quantity', 1,
      'performer_ids', jsonb_build_array(pg_temp.emp('Николай')),
      'photos', jsonb_build_array(pg_temp.ph('00000000-0000-0000-0000-000000000002', 9))))));
  raise exception 'ПРОВАЛ: прикреплено фото из чужой папки';
exception when insufficient_privilege then raise notice 'ok: фото из чужой папки прикрепить нельзя';
end $$;
do $$ begin
  perform public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(),
    'entries', jsonb_build_array(jsonb_build_object('department_id', 1, 'custom_name', 'Четыре фото', 'unit_id', 1, 'quantity', 1,
      'performer_ids', jsonb_build_array(pg_temp.emp('Николай')),
      'photos', jsonb_build_array(pg_temp.ph('00000000-0000-0000-0000-000000000001', 11), pg_temp.ph('00000000-0000-0000-0000-000000000001', 12),
                                  pg_temp.ph('00000000-0000-0000-0000-000000000001', 13), pg_temp.ph('00000000-0000-0000-0000-000000000001', 14))))));
  raise exception 'ПРОВАЛ: 4 фото';
exception when raise_exception then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: не больше 3 фото на работу';
end $$;
do $$ begin
  insert into public.entry_photos (entry_id, position, path, thumb_path) values (1, 1, 'x', 'y');
  raise exception 'ПРОВАЛ: прямая запись фото';
exception when insufficient_privilege then raise notice 'ok: фото пишутся только через отправку смены';
end $$;

-- видимость: напарник видит, посторонний мастер — нет
reset role;
select pg_temp.login_as('misha');
select pg_temp.assert(
  (select count(*) from public.entry_photos_for(array(select id from public.work_entries where custom_name = 'Распил МДФ'))) = 2,
  'напарник-исполнитель видит фото');
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000003', 'zhenya@uchet.local') on conflict do nothing;
update public.employees set user_id = '00000000-0000-0000-0000-000000000003', login = 'zhenya' where first_name = 'Евгений';
select pg_temp.login_as('zhenya');
select pg_temp.assert(
  (select count(*) from public.entry_photos_for(array(select e.id from public.work_entries e))) = 0
  and (select count(*) from public.entry_photos) = 0,
  'посторонний мастер не видит чужие фото');
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert(
  (select count(*) from public.entry_photos_for(array(select e.id from public.work_entries e))) = 2, 'руководитель видит фото');

-- отклонение и исправление с заменой фото: старое уходит в корзину
select public.reject_entry((select id from public.work_entries where custom_name = 'Распил МДФ'), 'Не видно, что сделано');
reset role;
select pg_temp.login_as('kolya');
select public.resubmit_entry((select id from public.work_entries where custom_name = 'Распил МДФ'),
  'Распил МДФ', 1::smallint, 1, 'вот фото',
  null, jsonb_build_array(pg_temp.ph('00000000-0000-0000-0000-000000000001', 1), pg_temp.ph('00000000-0000-0000-0000-000000000001', 3)));
select pg_temp.assert(
  (select string_agg(left(split_part(path, '/', 2), 8), ',' order by position) from public.entry_photos) = '00000001,00000003',
  'исправление: оставлено одно старое фото и добавлено новое');
reset role;
select pg_temp.assert((select count(*) from public.photo_cleanup_batch()) = 2, 'заменённое фото (с миниатюрой) — в корзине');

-- удаление работы руководителем — фото в корзину
select pg_temp.login_as('boss');
select public.admin_delete_entry((select id from public.work_entries where custom_name = 'Распил МДФ'));
reset role;
select pg_temp.assert((select count(*) from public.entry_photos) = 0, 'удалена работа — удалены записи фото');
select pg_temp.assert((select count(*) from public.photo_cleanup_batch()) = 6, 'все файлы удалённой работы — в корзине');
select public.photo_cleanup_done(array(select path from public.photo_cleanup_batch()));
select pg_temp.assert(not exists (select 1 from public.photo_cleanup_batch()), 'после уборки корзина пуста');
rollback;
