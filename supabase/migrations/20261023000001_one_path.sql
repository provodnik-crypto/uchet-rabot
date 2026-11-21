-- Один путь мастера: «заявка от начала до конца» (решение заказчика 23.10.2026).
-- * Работа вносится только внутри своей заявки «В работе» и сразу сохраняется (add_request_work), с датой
--   внесения. Работы мастера за день лежат в его «дне» — смене с постоянным client_uuid (day_shift_uuid);
--   мастер её не видит, отчёты и рейтинг считают как раньше. Старые смены не трогаются.
-- * Свою работу в заявке «В работе» мастер может исправить (замена) или удалить; после отправки — только руководитель.
-- * Дату работы меняет только руководитель (admin_set_entry_date: работа переезжает в день мастера на эту дату).
-- * Мастер не создаёт заявки: create_manual_request и номера в сменах — только руководитель.
--   «Работа без заявки» — плановая работа (start_planned_work): заявка № N, сразу «В работе» у мастера.
-- * «Отправить на проверку» с фото результата: минимум 1, до 3 (send_request_for_review_photos).
-- * «Сообщить руководителю»: master_reports — текст и до 3 фото; руководитель создаёт заявку, отмечает
--   «прочитано» (при открытии) или отклоняет с причиной; мастер видит ответ.
-- * Фото результата и сообщений — таблица extra_photos; ночная чистка фото их не удаляет.
-- Только добавляет и сужает права мастера; старое приложение работает (кроме создания заявок мастером).
-- Откат: supabase/rollback/20261023000001_one_path_down.sql

-- ---------- Фото вне работ: результат заявки и сообщения мастеров ----------
create table public.extra_photos (
  id bigserial primary key,
  owner_kind text not null check (owner_kind in ('result', 'report')),
  owner_id bigint not null,
  position smallint not null,
  path text not null unique,
  thumb_path text not null unique,
  width int, height int, size_bytes int,
  uploaded_by bigint references public.employees(id),
  created_at timestamptz not null default now()
);
create index extra_photos_owner_idx on public.extra_photos (owner_kind, owner_id);
alter table public.extra_photos enable row level security;
revoke all on public.extra_photos from anon, authenticated;

/** Проверить и записать фото (уже загружены приложением в хранилище в папку пользователя). */
create function public.attach_extra_photos(p_kind text, p_owner bigint, p_photos jsonb, p_min int) returns void
language plpgsql security definer set search_path = public as $$
declare
  ph jsonb;
  n int := coalesce((select max(position) from extra_photos where owner_kind = p_kind and owner_id = p_owner), 0);
  v_folder text := auth.uid()::text || '/';
  v_has_storage boolean := to_regclass('storage.objects') is not null;
  v_found boolean;
  v_count int := case when jsonb_typeof(p_photos) = 'array' then jsonb_array_length(p_photos) else 0 end;
begin
  if v_count < p_min then raise exception 'Добавьте фото результата'; end if;
  if v_count > 3 then raise exception 'Не больше 3 фото'; end if;
  if v_count = 0 then return; end if;
  for ph in select * from jsonb_array_elements(p_photos) loop
    if coalesce(ph ->> 'path', '') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
       or coalesce(ph ->> 'thumb_path', '') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}_t\.jpg$'
       or left(ph ->> 'path', length(v_folder)) <> v_folder
       or left(ph ->> 'thumb_path', length(v_folder)) <> v_folder then
      raise exception 'Фото не найдено' using errcode = '42501';
    end if;
    if v_has_storage then
      execute 'select exists (select 1 from storage.objects where bucket_id = ''work-photos'' and name = $1)'
        into v_found using ph ->> 'path';
      if not v_found then raise exception 'Фото ещё не загружено, нажмите «Повторить»'; end if;
    end if;
    n := n + 1;
    insert into extra_photos (owner_kind, owner_id, position, path, thumb_path, width, height, size_bytes, uploaded_by)
    values (p_kind, p_owner, n, ph ->> 'path', ph ->> 'thumb_path',
            nullif(ph ->> 'width', '')::int, nullif(ph ->> 'height', '')::int, nullif(ph ->> 'size_bytes', '')::int,
            public.current_employee_id())
    on conflict (path) do nothing;
    delete from photo_trash where path in (ph ->> 'path', ph ->> 'thumb_path');
  end loop;
end $$;

-- ночная чистка: файлы фото результата и сообщений не удалять
do $$
declare d text;
begin
  d := pg_get_functiondef('public.photo_cleanup_batch(integer)'::regprocedure);
  d := replace(d, 'where not exists (select 1 from entry_photos p where p.path = t.path or p.thumb_path = t.path)',
    'where not exists (select 1 from entry_photos p where p.path = t.path or p.thumb_path = t.path)
      and not exists (select 1 from extra_photos x where x.path = t.path or x.thumb_path = t.path)');
  d := replace(d, 'and not exists (select 1 from public.entry_photos p where p.path = o.name or p.thumb_path = o.name)',
    'and not exists (select 1 from public.entry_photos p where p.path = o.name or p.thumb_path = o.name)
         and not exists (select 1 from public.extra_photos x where x.path = o.name or x.thumb_path = o.name)');
  if position('extra_photos x where x.path = t.path' in d) = 0 or position('extra_photos x where x.path = o.name' in d) = 0 then
    raise exception 'photo_cleanup_batch: не удалось дописать проверку extra_photos';
  end if;
  execute d;
end $$;

-- ---------- День мастера: смена-контейнер для работ, внесённых в заявках ----------
create function public.day_shift_uuid(p_author bigint, p_date date) returns uuid
language sql immutable as $$ select md5('day:' || p_author || ':' || p_date)::uuid $$;

/** Смена-«день» мастера на дату (создаётся при первой работе). */
create function public.day_shift(p_author bigint, p_date date) returns public.shifts
language plpgsql security definer set search_path = public as $$
declare s shifts;
begin
  select * into s from shifts where client_uuid = public.day_shift_uuid(p_author, p_date) for update;
  if s.id is null then
    insert into shifts (work_date, author_id, client_uuid) values (p_date, p_author, public.day_shift_uuid(p_author, p_date))
    on conflict (client_uuid) do nothing;
    select * into s from shifts where client_uuid = public.day_shift_uuid(p_author, p_date) for update;
  end if;
  return s;
end $$;

/** Одна работа в смену: та же проверка и расчёт денег, что в submit_shift_core. Возвращает id работы. */
create function public.insert_work_entry(p_shift public.shifts, p_req bigint, p_entry jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_pos int := coalesce((select max(position) from work_entries where shift_id = p_shift.id), 0) + 1;
  v_qty numeric; v_item price_items; v_unit units; v_price bigint; v_perf bigint[]; v_entry_id bigint; v_emp bigint; i int := 0;
begin
  if not exists (select 1 from departments where id = (p_entry ->> 'department_id')::smallint and is_active) then
    raise exception 'Выберите отдел';
  end if;
  begin
    v_qty := (p_entry ->> 'quantity')::numeric;
  exception when others then
    raise exception 'Объём должен быть числом';
  end;
  if v_qty is null or v_qty <= 0 then raise exception 'Объём должен быть больше нуля'; end if;
  if v_qty <> round(v_qty, 3) then raise exception 'Объём: не больше трёх знаков после запятой'; end if;
  if p_entry ? 'price_item_id' and p_entry ->> 'price_item_id' is not null then
    select * into v_item from price_items where id = (p_entry ->> 'price_item_id')::bigint and is_active and not is_material;
    if not found then raise exception 'Позиция прайса не найдена или выключена'; end if;
    select * into v_unit from units where id = v_item.unit_id;
    v_price := public.price_on(v_item.id, p_shift.work_date);
    if v_price is null then raise exception 'У позиции «%» нет цены на эту дату', v_item.short_name; end if;
  else
    v_item := null;
    if length(trim(coalesce(p_entry ->> 'custom_name', ''))) < 3 then raise exception 'Введите название работы (не короче 3 букв)'; end if;
    select * into v_unit from units where id = (p_entry ->> 'unit_id')::smallint;
    if not found then raise exception 'Выберите единицу измерения'; end if;
    v_price := null;
  end if;
  if v_unit.integer_only and v_qty <> trunc(v_qty) then
    raise exception 'Для «%» объём должен быть целым числом', v_unit.code;
  end if;
  select array_agg(distinct x::bigint) into v_perf from jsonb_array_elements_text(coalesce(p_entry -> 'performer_ids', '[]'::jsonb)) x;
  if v_perf is null or cardinality(v_perf) = 0 then raise exception 'Выберите исполнителя'; end if;
  if (select count(*) from employees where id = any (v_perf) and is_active and role in ('master', 'manager')) <> cardinality(v_perf) then
    raise exception 'Исполнитель не найден или отключён';
  end if;

  insert into work_entries (shift_id, position, request_id, department_id, price_item_id, custom_name, unit_id, quantity, note, status)
  values (p_shift.id, v_pos, p_req, (p_entry ->> 'department_id')::smallint, v_item.id,
          case when v_item.id is null then trim(p_entry ->> 'custom_name') end,
          v_unit.id, v_qty, nullif(trim(p_entry ->> 'note'), ''),
          case when v_item.id is null then 'pending' else 'priced' end)
  returning id into v_entry_id;
  for v_emp in
    select x::bigint from jsonb_array_elements_text(p_entry -> 'performer_ids') with ordinality as t(x, n) group by x order by min(n)
  loop
    i := i + 1;
    insert into entry_performers (entry_id, employee_id, position, share) values (v_entry_id, v_emp, i, round(1.0 / cardinality(v_perf), 6));
  end loop;
  perform public.attach_entry_photos(v_entry_id, p_entry -> 'photos', v_pos);
  if v_item.id is not null then
    insert into entry_money (entry_id, unit_price_kop, total_kop, price_source)
    values (v_entry_id, v_price, round(v_qty * v_price)::bigint, 'price_list');
    perform public.recompute_performer_money(v_entry_id);
  end if;
  update shifts set updated_at = now() where id = p_shift.id;
  return v_entry_id;
end $$;

/** Можно ли мастеру менять работу: его, в его заявке «В работе», ещё не обработана руководителем. */
create function public.my_editable_entry(p_entry bigint) returns public.work_entries
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_employee_id(); w work_entries;
begin
  select w2.* into w from work_entries w2
  join shifts s on s.id = w2.shift_id
  join requests r on r.id = w2.request_id
  left join entry_money m on m.entry_id = w2.id
  where w2.id = p_entry and s.author_id = me and r.responsible_id = me and r.status = 'in_work' and r.is_open
    and w2.status <> 'rejected' and coalesce(m.price_source, '') <> 'manual';
  return w;
end $$;

/** «+ Добавить работу» в своей заявке «В работе» (p_replace — исправление своей работы). */
create function public.add_request_work(p_request bigint, p_entry jsonb, p_replace bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  r requests;
  s shifts;
  old work_entries;
  v_id bigint;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select * into r from requests where id = p_request for update;
  if r.id is null then raise exception 'Заявка не найдена'; end if;
  if r.status <> 'in_work' or r.responsible_id is distinct from me or not r.is_open then
    raise exception 'Работы вносит мастер, у которого заявка «В работе»';
  end if;
  if p_replace is not null then
    old := public.my_editable_entry(p_replace);
    if old.id is null or old.request_id <> p_request then raise exception 'Эту работу уже нельзя изменить'; end if;
    select * into s from shifts where id = old.shift_id for update;
    delete from work_entries where id = old.id;   -- фото уходят в корзину триггером; новые снова привяжутся
  else
    s := public.day_shift(me, public.app_today());
  end if;
  v_id := public.insert_work_entry(s, p_request, p_entry);
  update requests set last_activity_at = now() where id = p_request;
  return v_id;
end $$;

create function public.delete_my_work(p_entry bigint) returns void
language plpgsql security definer set search_path = public as $$
declare w work_entries;
begin
  w := public.my_editable_entry(p_entry);
  if w.id is null then raise exception 'Эту работу уже нельзя удалить'; end if;
  delete from work_entries where id = w.id;
  delete from shifts x where x.id = w.shift_id and not exists (select 1 from work_entries where shift_id = w.shift_id)
    and not exists (select 1 from shift_requests where shift_id = w.shift_id);
end $$;

/** Руководитель меняет дату работы: работа переезжает в день мастера (автора смены) на новую дату. */
create function public.admin_set_entry_date(p_entry bigint, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare w work_entries; old_s shifts; new_s shifts;
begin
  perform public.require_manager();
  if p_date is null or p_date > public.app_today() then raise exception 'Дата не может быть в будущем'; end if;
  select * into w from work_entries where id = p_entry for update;
  if w.id is null then raise exception 'Работа не найдена'; end if;
  select * into old_s from shifts where id = w.shift_id;
  if old_s.work_date = p_date then return; end if;
  new_s := public.day_shift(old_s.author_id, p_date);
  update work_entries set shift_id = new_s.id,
         position = coalesce((select max(position) from work_entries where shift_id = new_s.id), 0) + 1
  where id = p_entry;
  delete from shifts x where x.id = old_s.id and not exists (select 1 from work_entries where shift_id = old_s.id)
    and not exists (select 1 from shift_requests where shift_id = old_s.id);
end $$;

-- ---------- Мастер не создаёт заявки ----------
do $$
declare d text;
begin
  d := pg_get_functiondef('public.create_manual_request(text, text, bigint)'::regprocedure);
  d := replace(d, $r$  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Напишите, что нужно сделать'; end if;$r$,
    $r$  if not v_manager then raise exception 'Создавать заявки может только руководитель. Сообщите ему: «Заявки» → «Сообщить руководителю».'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Напишите, что нужно сделать'; end if;$r$);
  if position('Создавать заявки может только руководитель' in d) = 0 then raise exception 'create_manual_request: не нашёл место'; end if;
  execute d;

  d := pg_get_functiondef('public.submit_shift(jsonb)'::regprocedure);
  d := replace(d, '      insert into requests (number, created_by) values (v_num, me) on conflict (number) do nothing;
      select id into v_req from requests where number = v_num;',
    '      select id into v_req from requests where number = v_num;
      if v_req is null then raise exception ''Заявка % не найдена. Номер вводить не нужно — сообщите руководителю'', v_num; end if;');
  if position('Номер вводить не нужно' in d) = 0 then raise exception 'submit_shift: не нашёл место'; end if;
  execute d;

  d := pg_get_functiondef('public.save_shift_requests(bigint, jsonb)'::regprocedure);
  d := replace(d, '      insert into requests (number, created_by) values (v_num, v_author) on conflict (number) do nothing;
      select id into v_req from requests where number = v_num;',
    '      select id into v_req from requests where number = v_num;
      if v_req is null and not public.is_manager() then raise exception ''Заявка % не найдена'', v_num; end if;
      if v_req is null then
        insert into requests (number, created_by) values (v_num, v_author) on conflict (number) do nothing;
        select id into v_req from requests where number = v_num;
      end if;');
  if position('Заявка % не найдена' in d) = 0 then raise exception 'save_shift_requests: не нашёл место'; end if;
  execute d;
end $$;

-- ---------- «Работа без заявки»: плановая работа ----------
alter table public.requests add column is_planned boolean not null default false;
grant select (is_planned) on public.requests to authenticated;

create function public.start_planned_work(p_title text, p_details text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_store smallint;
  v_id bigint;
  v_number text;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Напишите, что за работа'; end if;
  if length(trim(p_title)) > 200 then raise exception 'Слишком длинно: до 200 знаков, подробности — ниже'; end if;
  perform public.assert_free(me, null, true);
  select coalesce(e.store_id, public.default_store_id()) into v_store from employees e where e.id = me;
  v_number := nextval('public.manual_request_seq')::text;
  insert into requests (number, source, store_id, operation, subject, description, registered_at, created_by,
                        status, responsible_id, taken_at, assignee_id, last_activity_at, is_planned)
  values (v_number, 'manual', v_store, trim(p_title), trim(p_title), nullif(trim(coalesce(p_details, '')), ''),
          (now() at time zone public.app_timezone()), me, 'in_work', me, now(), me, now(), true)
  returning id into v_id;
  insert into request_events (request_id, kind, author_id, to_status, comment)
  values (v_id, 'create', me, 'in_work', 'Плановая работа № ' || v_number);
  insert into request_events (request_id, kind, author_id, from_status, to_status) values (v_id, 'take', me, 'waiting', 'in_work');
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;

-- ---------- Отправка на проверку с фото результата ----------
create function public.send_request_for_review_photos(p_id bigint, p_comment text, p_photos jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id();
begin
  if not exists (select 1 from requests where id = p_id and status = 'in_work' and responsible_id = me) then
    raise exception 'Отправить может только мастер, который взял заявку';
  end if;
  perform public.attach_extra_photos('result', p_id, coalesce(p_photos, '[]'::jsonb), 1);
  perform public.send_request_for_review(p_id, p_comment);
end $$;

-- ---------- «Сообщить руководителю» ----------
create table public.master_reports (
  id bigserial primary key,
  author_id bigint not null references public.employees(id),
  text text not null check (length(text) between 3 and 1000
    and text !~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+'
    and text !~ '(^|\D)(\+7|8)?[\s(-]*\d{3}[\s)-]{0,2}\d{3}[\s-]?\d{2}[\s-]?\d{2}($|\D)'),
  status text not null default 'new' check (status in ('new', 'read', 'request', 'rejected')),
  answer text check (answer is null or length(answer) <= 1000),
  request_id bigint references public.requests(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by bigint references public.employees(id),
  seen_at timestamptz
);
create index master_reports_status_idx on public.master_reports (status, created_at desc);
alter table public.master_reports enable row level security;
revoke all on public.master_reports from anon, authenticated;
revoke all on sequence public.master_reports_id_seq from anon, authenticated;

create function public.create_master_report(p_text text, p_photos jsonb default '[]'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id(); v_id bigint;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if length(trim(coalesce(p_text, ''))) < 3 then raise exception 'Напишите, что случилось'; end if;
  insert into master_reports (author_id, text) values (me, trim(p_text)) returning id into v_id;
  perform public.attach_extra_photos('report', v_id, coalesce(p_photos, '[]'::jsonb), 0);
  return v_id;
end $$;

create function public.report_photos(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('path', x.path, 'thumb_path', x.thumb_path) order by x.position), '[]'::jsonb)
  from extra_photos x where x.owner_kind = 'report' and x.owner_id = p_id
$$;

/** Мастеру: его сообщения и ответы (последние 30). */
create function public.my_master_reports() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'text', m.text, 'status', m.status, 'answer', m.answer, 'created_at', m.created_at,
           'decided_at', m.decided_at, 'request_id', m.request_id,
           'request_number', (select r.number from requests r where r.id = m.request_id),
           'unseen', m.decided_at is not null and m.seen_at is null and m.status <> 'read',
           'photos', public.report_photos(m.id)) order by m.created_at desc), '[]'::jsonb)
  from (select * from master_reports where author_id = public.current_employee_id() order by created_at desc limit 30) m
$$;

create function public.mark_my_reports_seen() returns void
language sql security definer set search_path = public as $$
  update master_reports set seen_at = now()
  where author_id = public.current_employee_id() and decided_at is not null and seen_at is null
$$;

/** Руководителю: сообщения мастеров (новые — сверху). */
create function public.list_master_reports(p_open boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return coalesce((select jsonb_agg(jsonb_build_object(
           'id', m.id, 'text', m.text, 'status', m.status, 'answer', m.answer, 'created_at', m.created_at,
           'author', e.display_name, 'request_id', m.request_id,
           'request_number', (select r.number from requests r where r.id = m.request_id),
           'photos', public.report_photos(m.id)) order by (m.status in ('new', 'read')) desc, m.created_at desc)
    from (select * from master_reports
          where not p_open or status in ('new', 'read') or created_at > now() - interval '30 days'
          order by created_at desc limit 100) m
    join employees e on e.id = m.author_id), '[]'::jsonb);
end $$;

/** Решение руководителя: read — прочитано; reject — отклонить с причиной; request — создать заявку. */
create function public.decide_master_report(p_id bigint, p_action text, p_comment text default null, p_title text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m master_reports; v_req jsonb;
begin
  perform public.require_manager();
  select * into m from master_reports where id = p_id for update;
  if m.id is null then raise exception 'Сообщение не найдено'; end if;
  if p_action = 'read' then
    if m.status = 'new' then
      update master_reports set status = 'read', decided_at = now(), decided_by = public.current_employee_id() where id = p_id;
    end if;
    return null;
  elsif p_action = 'reject' then
    if length(trim(coalesce(p_comment, ''))) < 3 then raise exception 'Напишите мастеру причину'; end if;
    update master_reports set status = 'rejected', answer = trim(p_comment), decided_at = now(),
           decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return null;
  elsif p_action = 'request' then
    if m.status = 'request' then raise exception 'Заявка по сообщению уже создана'; end if;
    v_req := public.create_manual_request(coalesce(nullif(trim(p_title), ''), left(m.text, 200)), m.text, null);
    update master_reports set status = 'request', request_id = (v_req ->> 'id')::bigint, answer = nullif(trim(coalesce(p_comment, '')), ''),
           decided_at = now(), decided_by = public.current_employee_id(), seen_at = null where id = p_id;
    return v_req;
  end if;
  raise exception 'Неизвестное действие';
end $$;

-- ---------- Карточка, уведомления ----------
do $$
declare
  d text; n text; f text;
  pairs text[][] := array[
    array['public.request_card(bigint, text)', $r$      select jsonb_agg(jsonb_build_object(
               'work_date', s.work_date,$r$,
          $r$      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'department_id', w.department_id, 'price_item_id', w.price_item_id, 'unit_id', w.unit_id,
               'integer_only', u.integer_only, 'note', w.note, 'category', p.category, 'custom', w.price_item_id is null,
               'performer_ids', (select jsonb_agg(ep.employee_id order by ep.position) from entry_performers ep where ep.entry_id = w.id),
               'can_edit', (public.my_editable_entry(w.id)).id is not null,
               'work_date', s.work_date,$r$],
    array['public.request_card(bigint, text)', $r$'taken_at', r.taken_at,$r$,
          $r$'taken_at', r.taken_at, 'is_planned', r.is_planned,
    'result_photos', coalesce((select jsonb_agg(jsonb_build_object('path', x.path, 'thumb_path', x.thumb_path, 'at', x.created_at) order by x.created_at, x.position)
                               from extra_photos x where x.owner_kind = 'result' and x.owner_id = r.id), '[]'::jsonb),$r$],
    array['public.my_notifications()', $r$'pause_requests', (select count(*)::int from requests r where r.pause_request is not null and r.is_open),$r$,
          $r$'pause_requests', (select count(*)::int from requests r where r.pause_request is not null and r.is_open),
      'reports', (select count(*)::int from master_reports m where m.status = 'new'),$r$],
    array['public.my_notifications()', $r$    'returned', coalesce($r$,
          $r$    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status, 'text', left(m.text, 80),
                                                     'answer', m.answer, 'request_number', (select r.number from requests r where r.id = m.request_id)))
        from master_reports m where m.author_id = me and m.decided_at is not null and m.seen_at is null and m.status <> 'read'), '[]'::jsonb),
    'returned', coalesce($r$]
  ];
  i int;
  defs jsonb := '{}';
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := coalesce(defs ->> f, pg_get_functiondef(f::regprocedure));
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][2], f; end if;
    defs := defs || jsonb_build_object(f, n);
  end loop;
  for f in select jsonb_object_keys(defs) loop execute defs ->> f; end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.add_request_work(bigint, jsonb, bigint)', 'public.delete_my_work(bigint)',
    'public.admin_set_entry_date(bigint, date)', 'public.start_planned_work(text, text)',
    'public.send_request_for_review_photos(bigint, text, jsonb)', 'public.create_master_report(text, jsonb)',
    'public.my_master_reports()', 'public.mark_my_reports_seen()', 'public.list_master_reports(boolean)',
    'public.decide_master_report(bigint, text, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.attach_extra_photos(text, bigint, jsonb, integer)', 'public.day_shift(bigint, date)',
    'public.insert_work_entry(shifts, bigint, jsonb)', 'public.my_editable_entry(bigint)', 'public.report_photos(bigint)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
notify pgrst, 'reload schema';
