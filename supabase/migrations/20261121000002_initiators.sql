-- Этап «Инициаторы» (21.11.2026). Продавцы, менеджеры отделов и руководители секторов создают заявки
-- из приложения, минуя ITSM. Только добавляет; откат — supabase/rollback/20261121000002_initiators_down.sql
-- Роли и права (решения заказчика):
--  * учётку создаёт руководитель: «Имя П.», отдел, LDAP (личный номер), градация 1-2-3;
--  * градация: 1 «Сотрудник», 2 «Менеджер отдела», 3 «Руководитель сектора»; рабочие телефоны 031xxx —
--    только у градаций 2 и 3 (контроль — в admin-users, не в базе);
--  * мобильный телефон инициатор вносит сам — персональные данные, поэтому в отдельной таблице
--    initiator_contacts без грантов authenticated (видит только руководитель через функцию);
--  * заявка инициатора: чип «вид работ» → operation, описание → subject (до 200 знаков, без телефонов/почты),
--    отдел + «где точно» + фото 1–3 (обязательно) + срок (Планово / К дате / Срочно с причиной) + материалы;
--  * заявка падает руководителю как обычная новая (status 'waiting'); инициатор не выбирает мастера;
--  * инициатор видит свои заявки и заявки своего отдела (RLS), отменить может свою, пока «Новая»;
--  * create_manual_request и все старые функции не тронуты: current_employee_id() по-прежнему не пускает
--    инициаторов (роль 'initiator'), открыты только новые функции ниже.

-- ---------- Сотрудники: отдел, градация, рабочий телефон, LDAP ----------
alter table public.employees add column department_id smallint references public.departments (id);
alter table public.employees add column grade smallint check (grade between 1 and 3);
alter table public.employees add column work_phone text check (work_phone ~ '^031\d{3}$');
alter table public.employees add column ldap_code text check (ldap_code ~ '^\d{3,20}$') unique;
grant select (department_id, grade, work_phone, ldap_code) on public.employees to authenticated;

-- ---------- Заявки: отдел, место, материалы, причина срочности ----------
alter table public.requests add column department_id smallint references public.departments (id);
alter table public.requests add column place text check (place is null or length(trim(place)) between 1 and 200);
alter table public.requests add column materials text check (materials is null or length(trim(materials)) between 1 and 300);
alter table public.requests add column urgent_reason text check (urgent_reason is null or length(trim(urgent_reason)) between 1 and 200);
grant select (department_id, place, materials, urgent_reason) on public.requests to authenticated;

-- ---------- Мобильный телефон инициатора (персональные данные: вне прямого доступа) ----------
create table public.initiator_contacts (
  employee_id bigint primary key references public.employees (id) on delete cascade,
  mobile text check (mobile is null or mobile ~ '^\+?\d{10,12}$'),
  updated_at timestamptz not null default now()
);
alter table public.initiator_contacts enable row level security;
revoke all on public.initiator_contacts from anon, authenticated;

-- ---------- Попытки первого входа по LDAP (защита от подбора) ----------
create table public.claim_attempts (
  id bigserial primary key,
  ldap text not null,
  ip text,
  attempted_at timestamptz not null default now()
);
create index claim_attempts_ldap_idx on public.claim_attempts (ldap, attempted_at);
revoke all on public.claim_attempts from anon, authenticated;

-- ---------- Помощники ----------
create function public.current_initiator_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.employees
  where user_id = auth.uid() and is_active and role = 'initiator'
$$;
revoke all on function public.current_initiator_id() from public, anon;
grant execute on function public.current_initiator_id() to authenticated;

create function public.is_initiator() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_initiator_id() is not null
$$;
revoke all on function public.is_initiator() from public, anon;
grant execute on function public.is_initiator() to authenticated;

create function public.require_initiator() returns bigint
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return me;
end $$;
revoke all on function public.require_initiator() from public, anon;
grant execute on function public.require_initiator() to authenticated;

/** Телефоны и почта в свободном тексте не нужны (как requests_description_clean, но для новых полей). */
create function public.assert_clean_text(p_text text, p_label text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_text is null then return; end if;
  if p_text ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+'
     or p_text ~ '(^|\D)(\+7|8)?[\s(-]*\d{3}[\s)-]{0,2}\d{3}[\s-]?\d{2}[\s-]?\d{2}($|\D)' then
    raise exception '%: телефон или почта в тексте не нужны — руководитель видит их в карточке', p_label;
  end if;
end $$;

-- ---------- Доступ инициатора к заявкам: свои + заявки своего отдела ----------
-- Раньше политика пускала всех вошедших ко всем заявкам (мастер/руководитель читают колонками и RPC).
-- Для инициаторов сужаем; мастер/руководитель видят всё как раньше (current_employee_id не пустой).
drop policy requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated using (
  public.current_employee_id() is not null
  or exists (
    select 1 from employees me
    where me.user_id = auth.uid() and me.is_active and me.role = 'initiator'
      and (requests.created_by = me.id
           or (me.department_id is not null and requests.department_id = me.department_id)))
);

-- ---------- Фото заявки: инициатор видит фото заявок (как мастер) и грузит в свою папку ----------
create or replace function public.can_see_extra_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.is_manager() and exists (select 1 from extra_photos x where x.path = p_name or x.thumb_path = p_name))
      or (public.current_employee_id() is not null
          and exists (select 1 from extra_photos x where x.owner_kind = 'request' and (x.path = p_name or x.thumb_path = p_name)))
      or (public.current_initiator_id() is not null
          and exists (select 1 from extra_photos x where x.owner_kind = 'request' and (x.path = p_name or x.thumb_path = p_name)))
$$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists work_photos_insert_initiator on storage.objects;
    -- инициатор загружает фото в свою папку (как сотрудники; к созданию заявки прикладывает 1–3)
    create policy work_photos_insert_initiator on storage.objects for insert to authenticated
      with check (bucket_id = 'work-photos' and (storage.foldername(name))[1] = auth.uid()::text
                  and public.current_initiator_id() is not null);
  end if;
end $$;

-- ---------- Создание заявки инициатором ----------
create function public.create_initiator_request(
  p_category text, p_description text, p_department_id smallint, p_place text,
  p_due date default null, p_urgent boolean default false, p_urgent_reason text default null,
  p_materials text default null, p_photos jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_initiator_id();
  v_cat text := trim(coalesce(p_category, ''));
  v_desc text; v_place text; v_mat text; v_reason text;
  v_store smallint; v_dept smallint; v_id bigint; v_number text;
  v_has_storage boolean := to_regclass('storage.objects') is not null;
  v_found boolean; v_folder text; ph jsonb; v_n int := 0;
  v_categories text[] := array['Демонтаж', 'Замена', 'Ремонт', 'Оклейка', 'Размещение', 'Покраска', 'Сборка', 'Другое'];
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  -- (шлюз оценки «сначала оцените выполненную» добавит миграция части 2 — вместе с окном оценки)
  if not (v_cat = any (v_categories)) then raise exception 'Выберите, что нужно сделать'; end if;
  v_desc := trim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g'));
  if length(v_desc) < 3 then raise exception 'Опишите задачу'; end if;
  if length(v_desc) > 200 then raise exception 'Слишком длинно: до 200 знаков'; end if;
  perform public.assert_clean_text(v_desc, 'В описании');
  select id into v_dept from departments
    where id = coalesce(p_department_id, (select department_id from employees where id = me)) and is_active;
  if v_dept is null then raise exception 'Выберите отдел'; end if;
  v_place := nullif(trim(regexp_replace(coalesce(p_place, ''), '\s+', ' ', 'g')), '');
  if v_place is null then raise exception 'Укажите, где именно (аллея, подиум, бокс)'; end if;
  perform public.assert_clean_text(v_place, 'В поле «где»');
  v_mat := nullif(trim(regexp_replace(coalesce(p_materials, ''), '\s+', ' ', 'g')), '');
  if length(coalesce(v_mat, '')) > 300 then raise exception 'Материалы: до 300 знаков'; end if;
  perform public.assert_clean_text(v_mat, 'В материалах');
  if p_urgent then
    v_reason := nullif(trim(regexp_replace(coalesce(p_urgent_reason, ''), '\s+', ' ', 'g')), '');
    if v_reason is null then raise exception 'Укажите, почему это срочно'; end if;
    if length(v_reason) > 200 then raise exception 'Причина срочности: до 200 знаков'; end if;
    perform public.assert_clean_text(v_reason, 'В причине срочности');
  end if;
  -- фото: обязательно 1–3, загружены приложением в папку вызывающего (как у всех)
  if coalesce(jsonb_array_length(p_photos), 0) < 1 then raise exception 'Добавьте фото (минимум 1)'; end if;
  if jsonb_array_length(p_photos) > 3 then raise exception 'Не больше 3 фото'; end if;
  v_folder := auth.uid()::text || '/';
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
  end loop;
  select coalesce(store_id, public.default_store_id()) into v_store from employees where id = me;
  v_number := nextval('public.manual_request_seq')::text;
  insert into requests (number, source, store_id, operation, subject, description, registered_at, created_by,
                        status, priority, due_at, department_id, place, materials, urgent_reason, last_activity_at)
  values (v_number, 'initiator', v_store, v_cat, v_desc, null,
          (now() at time zone public.app_timezone()), me, 'waiting',
          case when p_urgent then 1 else 3 end,
          p_due::timestamp, v_dept, v_place, v_mat, case when p_urgent then v_reason end, now())
  returning id into v_id;
  v_n := 0;
  for ph in select * from jsonb_array_elements(p_photos) loop
    v_n := v_n + 1;
    insert into extra_photos (owner_kind, owner_id, position, path, thumb_path, width, height, size_bytes, uploaded_by)
    values ('request', v_id, v_n, ph ->> 'path', ph ->> 'thumb_path',
            nullif(ph ->> 'width', '')::int, nullif(ph ->> 'height', '')::int, nullif(ph ->> 'size_bytes', '')::int, me)
    on conflict (path) do nothing;
    delete from photo_trash where path in (ph ->> 'path', ph ->> 'thumb_path');
  end loop;
  insert into request_events (request_id, kind, author_id, to_status, comment)
  values (v_id, 'create', me, 'waiting', 'Заявка № ' || v_number);
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;
revoke all on function public.create_initiator_request(text, text, smallint, text, date, boolean, text, text, jsonb) from public, anon;
grant execute on function public.create_initiator_request(text, text, smallint, text, date, boolean, text, text, jsonb) to authenticated;

-- ---------- Отмена своей заявки, пока «Новая» ----------
create function public.cancel_initiator_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_initiator_id();
  r requests;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  select * into r from requests where id = p_id for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if r.created_by <> me then raise exception 'Отменить можно только свою заявку' using errcode = '42501'; end if;
  if not (r.is_open and r.status = 'waiting') then
    raise exception 'Заявку уже взяли в работу — об отмене попросите руководителя';
  end if;
  update requests set is_open = false, closed_at = now(), closed_by = me, last_activity_at = now() where id = r.id;
  insert into request_events (request_id, kind, author_id, comment)
  values (r.id, 'comment', me, 'Заявка отменена создателем');
end $$;
revoke all on function public.cancel_initiator_request(bigint) from public, anon;
grant execute on function public.cancel_initiator_request(bigint) to authenticated;

-- ---------- Списки: «Мои заявки» и «Заявки отдела» (старая сверху, новая снизу) ----------
create function public.initiator_requests(p_scope text) returns table (
  id bigint, number text, subject text, operation text, status text, priority smallint,
  place text, due_date date, materials text, urgent_reason text,
  created_at timestamptz, creator_name text, master_name text, department_name text, can_cancel boolean
)
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return query
    select r.id, r.number, r.subject, r.operation, r.status, r.priority,
           r.place, r.due_at::date, r.materials, r.urgent_reason,
           r.registered_at, cr.display_name, m.display_name, d.name,
           r.is_open and r.status = 'waiting'
    from requests r
    left join employees cr on cr.id = r.created_by
    left join employees m on m.id = r.assignee_id
    left join departments d on d.id = r.department_id
    where case when p_scope = 'department'
               then r.department_id is not null
                    and r.department_id = (select e.department_id from employees e where e.id = me)
               else r.created_by = me end
    order by r.registered_at asc, r.id asc;
end $$;
revoke all on function public.initiator_requests(text) from public, anon;
grant execute on function public.initiator_requests(text) to authenticated;

-- ---------- Карточка своей/отдела заявки (для инициатора) ----------
create function public.initiator_request_card(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'id', r.id, 'number', r.number, 'subject', r.subject, 'operation', r.operation,
      'status', r.status, 'priority', r.priority, 'place', r.place, 'materials', r.materials,
      'urgent_reason', r.urgent_reason, 'due_at', r.due_at, 'registered_at', r.registered_at,
      'creator_name', cr.display_name, 'master_name', m.display_name, 'department_name', d.name,
      'can_cancel', r.is_open and r.status = 'waiting' and r.created_by = me,
      'photos', coalesce((select jsonb_agg(jsonb_build_object('path', x.path, 'thumb_path', x.thumb_path) order by x.position)
                          from extra_photos x where x.owner_kind = 'request' and x.owner_id = r.id), '[]'::jsonb))
    from requests r
    left join employees cr on cr.id = r.created_by
    left join employees m on m.id = r.assignee_id
    left join departments d on d.id = r.department_id
    where r.id = p_id
      and (r.created_by = me
           or exists (select 1 from employees e where e.id = me and e.department_id is not null
                      and r.department_id = e.department_id)));
end $$;
revoke all on function public.initiator_request_card(bigint) from public, anon;
grant execute on function public.initiator_request_card(bigint) to authenticated;

-- ---------- Профиль инициатора ----------
create function public.initiator_profile() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'id', e.id, 'display_name', e.display_name, 'grade', e.grade,
      'department_id', e.department_id, 'department_name', d.name,
      'work_phone', e.work_phone, 'mobile', c.mobile)
    from employees e
    left join departments d on d.id = e.department_id
    left join initiator_contacts c on c.employee_id = e.id
    where e.id = me);
end $$;
revoke all on function public.initiator_profile() from public, anon;
grant execute on function public.initiator_profile() to authenticated;

-- ---------- Инициатор: сменить свой отдел / добавить отдел / вписать мобильный ----------
create function public.set_my_department(p_department_id smallint) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_initiator_id();
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if not exists (select 1 from departments where id = p_department_id and is_active) then
    raise exception 'Отдел не найден';
  end if;
  update employees set department_id = p_department_id where id = me;
end $$;
revoke all on function public.set_my_department(smallint) from public, anon;
grant execute on function public.set_my_department(smallint) to authenticated;

create function public.add_department(p_name text) returns smallint
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); v_id smallint;
begin
  if public.current_employee_id() is null and public.current_initiator_id() is null then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'Напишите название отдела'; end if;
  if length(v_name) > 40 then raise exception 'Слишком длинно: до 40 знаков'; end if;
  select id into v_id from departments where lower(trim(name)) = lower(v_name);
  if v_id is not null then return v_id; end if; -- уже есть — вернём его
  insert into departments (name) values (v_name) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_department(text) from public, anon;
grant execute on function public.add_department(text) to authenticated;

create function public.set_my_mobile(p_mobile text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_initiator_id();
  v text := nullif(trim(coalesce(p_mobile, '')), '');
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if v is not null and v !~ '^\+?\d{10,12}$' then
    raise exception 'Мобильный: 10–12 цифр, можно с +7';
  end if;
  insert into initiator_contacts (employee_id, mobile, updated_at) values (me, v, now())
  on conflict (employee_id) do update set mobile = excluded.mobile, updated_at = now();
end $$;
revoke all on function public.set_my_mobile(text) from public, anon;
grant execute on function public.set_my_mobile(text) to authenticated;

-- ---------- Вход в приложение: whoami узнаёт инициатора (current_employee_id() НЕ трогаем) ----------
create or replace function public.whoami()
returns table (id bigint, display_name text, role public.employee_role, login text)
language sql stable security definer set search_path = public as $$
  select e.id, e.display_name, e.role, e.login
  from public.employees e
  where e.user_id = auth.uid() and e.is_active and e.role in ('master', 'manager', 'initiator')
$$;

-- ---------- Руководителю: кто создал заявку, отдел, телефоны (только руководитель) ----------
create function public.request_initiator_info(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'creator_name', cr.display_name, 'creator_grade', cr.grade,
      'creator_work_phone', cr.work_phone, 'creator_mobile', c.mobile,
      'department_name', d.name, 'place', r.place, 'materials', r.materials,
      'urgent_reason', r.urgent_reason)
    from requests r
    left join employees cr on cr.id = r.created_by
    left join initiator_contacts c on c.employee_id = cr.id
    left join departments d on d.id = r.department_id
    where r.id = p_id);
end $$;
revoke all on function public.request_initiator_info(bigint) from public, anon;
grant execute on function public.request_initiator_info(bigint) to authenticated;
