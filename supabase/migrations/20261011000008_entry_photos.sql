-- Фото к работам. Файлы — в закрытом хранилище work-photos, в папке пользователя, который их снял:
-- <auth uid>/<uuid>.jpg и миниатюра <auth uid>/<uuid>_t.jpg. Видят фото те же, кто видит работу
-- (исполнители, автор смены, руководитель), — через подписанные ссылки с коротким сроком.
-- Удалённые фото попадают в photo_trash; файлы стирает серверная функция photo-cleanup по расписанию
-- (из SQL файлы хранилища удалять нельзя — только через сервис хранилища).

create table public.entry_photos (
  id           bigint generated always as identity primary key,
  entry_id     bigint not null references public.work_entries (id) on delete cascade,
  position     smallint not null,
  path         text not null,
  thumb_path   text not null,
  width        integer,
  height       integer,
  size_bytes   integer,
  uploaded_by  bigint references public.employees (id),
  created_at   timestamptz not null default now(),
  unique (entry_id, position),
  unique (path)
);

-- Не больше 3 фото на работу.
create or replace function public.check_entry_photo_limit() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select count(*) from entry_photos where entry_id = new.entry_id) >= 3 then
    raise exception 'К работе можно приложить не больше 3 фото' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger entry_photos_limit before insert on public.entry_photos
  for each row execute function public.check_entry_photo_limit();

create table public.photo_trash (
  path       text primary key,
  queued_at  timestamptz not null default now()
);

create or replace function public.trash_entry_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into photo_trash (path) values (old.path), (old.thumb_path) on conflict do nothing;
  return old;
end $$;
create trigger entry_photos_trash after delete on public.entry_photos
  for each row execute function public.trash_entry_photo();

-- Прикрепить фото к работе. p_photos: [{path, thumb_path, width, height, size_bytes}, ...].
-- Принимаются только файлы из папки вызывающего пользователя, уже загруженные в хранилище.
create or replace function public.attach_entry_photos(p_entry bigint, p_photos jsonb, p_pos int) returns void
language plpgsql security definer set search_path = public as $$
declare
  ph jsonb;
  n int := 0;
  v_folder text := auth.uid()::text || '/';
  v_has_storage boolean := to_regclass('storage.objects') is not null;
  v_found boolean;
begin
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) = 0 then return; end if;
  if jsonb_array_length(p_photos) > 3 then raise exception 'Работа %: не больше 3 фото', p_pos; end if;
  for ph in select * from jsonb_array_elements(p_photos) loop
    n := n + 1;
    if coalesce(ph ->> 'path', '') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
       or coalesce(ph ->> 'thumb_path', '') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}_t\.jpg$'
       or left(ph ->> 'path', length(v_folder)) <> v_folder
       or left(ph ->> 'thumb_path', length(v_folder)) <> v_folder then
      raise exception 'Работа %: фото не найдено', p_pos using errcode = '42501';
    end if;
    if v_has_storage then
      execute 'select exists (select 1 from storage.objects where bucket_id = ''work-photos'' and name = $1)'
        into v_found using ph ->> 'path';
      if not v_found then raise exception 'Работа %: фото ещё не загружено, нажмите «Повторить»', p_pos; end if;
    end if;
    insert into entry_photos (entry_id, position, path, thumb_path, width, height, size_bytes, uploaded_by)
    values (p_entry, n, ph ->> 'path', ph ->> 'thumb_path',
            nullif(ph ->> 'width', '')::int, nullif(ph ->> 'height', '')::int, nullif(ph ->> 'size_bytes', '')::int,
            public.current_employee_id());
    delete from photo_trash where path in (ph ->> 'path', ph ->> 'thumb_path');
  end loop;
end $$;

-- Фото для списка работ (история, очередь, журнал): только тех работ, которые пользователь и так видит.
create or replace function public.entry_photos_for(p_entry_ids bigint[])
returns table (entry_id bigint, photo_position smallint, path text, thumb_path text)
language sql stable security definer set search_path = public as $$
  select p.entry_id, p.position, p.path, p.thumb_path
  from entry_photos p
  where p.entry_id = any (p_entry_ids[1:500]) and public.can_see_entry(p.entry_id)
  order by p.entry_id, p.position
$$;

-- Для уборки (вызывает только серверная функция photo-cleanup с сервисным ключом):
-- файлы из корзины, на которые больше никто не ссылается, и брошенные загрузки старше суток.
create or replace function public.photo_cleanup_batch(p_limit int default 200) returns table (path text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select t.path from photo_trash t
    where not exists (select 1 from entry_photos p where p.path = t.path or p.thumb_path = t.path)
    limit greatest(p_limit, 1);
  if to_regclass('storage.objects') is not null then
    return query execute
      'select o.name from storage.objects o
       where o.bucket_id = ''work-photos'' and o.created_at < now() - interval ''1 day''
         and not exists (select 1 from public.entry_photos p where p.path = o.name or p.thumb_path = o.name)
       limit $1' using greatest(p_limit, 1);
  end if;
end $$;

create or replace function public.photo_cleanup_done(p_paths text[]) returns void
language sql security definer set search_path = public as $$
  delete from photo_trash where path = any (p_paths)
$$;

alter table public.entry_photos enable row level security;
alter table public.photo_trash enable row level security;
create policy entry_photos_select on public.entry_photos for select to authenticated using (public.can_see_entry(entry_id));
revoke all on public.entry_photos, public.photo_trash from anon, authenticated;
grant select on public.entry_photos to authenticated;

-- ---------- Отправка смены и исправление работы: теперь с фото ----------
create or replace function public.submit_shift(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me          bigint := public.current_employee_id();
  v_uuid      uuid;
  v_date      date;
  v_shift     shifts%rowtype;
  v_entry     jsonb;
  v_pos       int := 0;
  v_req_num   text;
  v_req_id    bigint;
  v_item      price_items%rowtype;
  v_unit      units%rowtype;
  v_qty       numeric;
  v_price     bigint;
  v_entry_id  bigint;
  v_perf      bigint[];
  v_emp       bigint;
  v_pending   int := 0;
  i           int;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  begin
    v_uuid := (payload ->> 'client_uuid')::uuid;
    v_date := (payload ->> 'work_date')::date;
  exception when others then
    raise exception 'Неверные данные смены';
  end;
  if v_uuid is null or v_date is null then raise exception 'Неверные данные смены'; end if;
  if jsonb_typeof(payload -> 'entries') <> 'array' or jsonb_array_length(payload -> 'entries') = 0 then
    raise exception 'В смене нет ни одной работы';
  end if;
  if jsonb_array_length(payload -> 'entries') > 100 then raise exception 'Слишком много работ в одной смене'; end if;

  select * into v_shift from shifts where client_uuid = v_uuid for update;
  if found then
    if v_shift.author_id <> me then raise exception 'Нет доступа' using errcode = '42501'; end if;
    if (v_shift.submitted_at at time zone public.app_timezone())::date <> public.app_today() and not public.is_manager() then
      raise exception 'Смену можно изменить только в день отправки. Обратитесь к руководителю.';
    end if;
    if exists (select 1 from work_entries e left join entry_money m on m.entry_id = e.id
               where e.shift_id = v_shift.id and (e.status = 'rejected' or m.price_source = 'manual')) then
      raise exception 'Руководитель уже обработал работы этой смены, изменить её нельзя.';
    end if;
  end if;

  if not public.is_manager() and v_date not in (public.app_today(), public.app_today() - 1) then
    raise exception 'Дата смены — сегодня или вчера';
  end if;

  if v_shift.id is null then
    insert into shifts (work_date, author_id, client_uuid) values (v_date, me, v_uuid) returning * into v_shift;
  else
    delete from work_entries where shift_id = v_shift.id;
    update shifts set work_date = v_date, updated_at = now() where id = v_shift.id;
  end if;

  for v_entry in select * from jsonb_array_elements(payload -> 'entries') loop
    v_pos := v_pos + 1;

    -- заявка: справочник пополняется номерами, которые вводят мастера
    v_req_id := null;
    v_req_num := upper(nullif(trim(v_entry ->> 'request_number'), ''));
    if v_req_num is not null then
      if v_req_num !~ '^(RFS|INC)\d{6}_\d{4}$' then
        raise exception 'Работа %: номер заявки % в неверном формате', v_pos, v_req_num;
      end if;
      insert into requests (number, created_by) values (v_req_num, me) on conflict (number) do nothing;
      select id into v_req_id from requests where number = v_req_num;
    end if;

    if not exists (select 1 from departments where id = (v_entry ->> 'department_id')::smallint and is_active) then
      raise exception 'Работа %: выберите отдел', v_pos;
    end if;

    begin
      v_qty := (v_entry ->> 'quantity')::numeric;
    exception when others then
      raise exception 'Работа %: объём должен быть числом', v_pos;
    end;
    if v_qty is null or v_qty <= 0 then raise exception 'Работа %: объём должен быть больше нуля', v_pos; end if;
    if v_qty <> round(v_qty, 3) then raise exception 'Работа %: не больше трёх знаков после запятой', v_pos; end if;

    if v_entry ? 'price_item_id' and v_entry ->> 'price_item_id' is not null then
      select * into v_item from price_items
      where id = (v_entry ->> 'price_item_id')::bigint and is_active and not is_material;
      if not found then raise exception 'Работа %: позиция прайса не найдена или выключена', v_pos; end if;
      select * into v_unit from units where id = v_item.unit_id;
      v_price := public.price_on(v_item.id, v_date);
      if v_price is null then raise exception 'Работа %: у позиции «%» нет цены на эту дату', v_pos, v_item.short_name; end if;
    else
      v_item := null;
      if length(trim(coalesce(v_entry ->> 'custom_name', ''))) < 3 then
        raise exception 'Работа %: введите название работы (не короче 3 букв)', v_pos;
      end if;
      select * into v_unit from units where id = (v_entry ->> 'unit_id')::smallint;
      if not found then raise exception 'Работа %: выберите единицу измерения', v_pos; end if;
      v_price := null;
    end if;
    if v_unit.integer_only and v_qty <> trunc(v_qty) then
      raise exception 'Работа %: для «%» объём должен быть целым числом', v_pos, v_unit.code;
    end if;

    -- исполнители: без повторов, только активные мастера
    select array_agg(distinct x::bigint) into v_perf
    from jsonb_array_elements_text(coalesce(v_entry -> 'performer_ids', '[]'::jsonb)) x;
    if v_perf is null or cardinality(v_perf) = 0 then raise exception 'Работа %: выберите исполнителя', v_pos; end if;
    if (select count(*) from employees where id = any (v_perf) and is_active and role in ('master', 'manager')) <> cardinality(v_perf) then
      raise exception 'Работа %: исполнитель не найден или отключён', v_pos;
    end if;

    insert into work_entries (shift_id, position, request_id, department_id, price_item_id, custom_name, unit_id, quantity, note, status)
    values (
      v_shift.id, v_pos, v_req_id, (v_entry ->> 'department_id')::smallint, v_item.id,
      case when v_item.id is null then trim(v_entry ->> 'custom_name') end,
      v_unit.id, v_qty, nullif(trim(v_entry ->> 'note'), ''),
      case when v_item.id is null then 'pending' else 'priced' end
    ) returning id into v_entry_id;

    -- порядок исполнителей как в запросе: первый получает остаток копеек
    i := 0;
    for v_emp in
      select x::bigint from jsonb_array_elements_text(v_entry -> 'performer_ids') with ordinality as t(x, n)
      group by x order by min(n)
    loop
      i := i + 1;
      insert into entry_performers (entry_id, employee_id, position, share)
      values (v_entry_id, v_emp, i, round(1.0 / cardinality(v_perf), 6));
    end loop;

    -- фото работы (до 3): файлы уже загружены приложением в хранилище
    perform public.attach_entry_photos(v_entry_id, v_entry -> 'photos', v_pos);

    if v_item.id is not null then
      insert into entry_money (entry_id, unit_price_kop, total_kop, price_source)
      values (v_entry_id, v_price, round(v_qty * v_price)::bigint, 'price_list');
      perform public.recompute_performer_money(v_entry_id);
    else
      v_pending := v_pending + 1;
    end if;
  end loop;

  return jsonb_build_object('shift_id', v_shift.id, 'entries', v_pos, 'pending', v_pending);
end $$;

drop function if exists public.resubmit_entry(bigint, text, smallint, numeric, text, bigint);
create or replace function public.resubmit_entry(
  p_entry bigint, p_custom_name text, p_unit_id smallint, p_quantity numeric, p_note text, p_price_item_id bigint default null,
  p_photos jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  e work_entries%rowtype;
  it price_items%rowtype;
  v_date date;
  v_price bigint;
begin
  select e2.* into e from work_entries e2 join shifts s on s.id = e2.shift_id
   where e2.id = p_entry and s.author_id = public.current_employee_id() for update of e2;
  if not found then raise exception 'Работа не найдена' using errcode = '42501'; end if;
  if e.status <> 'rejected' then raise exception 'Исправить можно только отклонённую работу'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Объём должен быть больше нуля'; end if;
  select work_date into v_date from shifts where id = e.shift_id;

  -- фото: null — не трогать; массив — заменить набор (оставленные старые + новые)
  if p_photos is not null then
    delete from entry_photos where entry_id = e.id;
    perform public.attach_entry_photos(e.id, p_photos, 1);
  end if;

  if p_price_item_id is not null then
    select * into it from price_items where id = p_price_item_id and is_active and not is_material;
    if not found then raise exception 'Позиция прайса не найдена или выключена'; end if;
    v_price := public.price_on(it.id, v_date);
    if v_price is null then raise exception 'У позиции нет цены на дату работы'; end if;
    update work_entries set price_item_id = it.id, custom_name = null, unit_id = it.unit_id, quantity = p_quantity,
           note = nullif(trim(p_note), ''), status = 'priced', reject_comment = null
     where id = e.id;
    insert into entry_money (entry_id, unit_price_kop, total_kop, price_source)
    values (e.id, v_price, greatest(round(p_quantity * v_price), 1)::bigint, 'price_list');
    perform public.recompute_performer_money(e.id);
  else
    if length(trim(coalesce(p_custom_name, ''))) < 3 then raise exception 'Введите название работы (не короче 3 букв)'; end if;
    if not exists (select 1 from units where id = p_unit_id) then raise exception 'Выберите единицу измерения'; end if;
    update work_entries set custom_name = trim(p_custom_name), unit_id = p_unit_id, quantity = p_quantity,
           note = nullif(trim(p_note), ''), status = 'pending', reject_comment = null
     where id = e.id;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.check_entry_photo_limit()', 'public.trash_entry_photo()',
    'public.attach_entry_photos(bigint, jsonb, int)',
    'public.photo_cleanup_batch(int)', 'public.photo_cleanup_done(text[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.entry_photos_for(bigint[])',
    'public.resubmit_entry(bigint, text, smallint, numeric, text, bigint, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  grant execute on function public.photo_cleanup_batch(int), public.photo_cleanup_done(text[]) to service_role;
end $$;

-- ---------- Хранилище (в настоящем Supabase; в локальных тестах схемы storage нет) ----------
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('work-photos', 'work-photos', false, 2097152, array['image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists work_photos_insert on storage.objects;
  drop policy if exists work_photos_select on storage.objects;
  -- загружать — только в свою папку и только сотрудникам
  create policy work_photos_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'work-photos' and (storage.foldername(name))[1] = auth.uid()::text
                and public.current_employee_id() is not null);
  -- видеть — свои загрузки (до отправки) и фото работ, которые видит сам
  create policy work_photos_select on storage.objects for select to authenticated
    using (bucket_id = 'work-photos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.entry_photos p
                 where (p.path = storage.objects.name or p.thumb_path = storage.objects.name)
                   and public.can_see_entry(p.entry_id))));
end $$;
