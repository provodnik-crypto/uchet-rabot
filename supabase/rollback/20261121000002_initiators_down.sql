-- Откат этапа «Инициаторы» (21.11.2026). Порядок отката дня: см. docs/RUN.md.
-- ВАЖНО: значение 'initiator' в enum employee_role удалить нельзя (Postgres не поддерживает
-- drop enum value) — оно остаётся, но все функции и данные этапа снимаются; старое приложение
-- инициаторов не показывает (роль не проходит whoami без функций ниже... whoami откатывается отдельно).
-- Точка восстановления данных: backups/db_backup_2026-11-21_initiators.json.gz.

-- ---------- Вход: whoami снова только мастер/руководитель ----------
create or replace function public.whoami()
returns table (id bigint, display_name text, role public.employee_role, login text)
language sql stable security definer set search_path = public as $$
  select e.id, e.display_name, e.role, e.login
  from public.employees e
  where e.user_id = auth.uid() and e.is_active and e.role in ('master', 'manager')
$$;

-- ---------- Поиск: возврат старой normalize_search ----------
create or replace function public.normalize_search(t text) returns text
language sql immutable parallel safe as $$
  select lower(replace(replace(coalesce(t, ''), 'ё', 'е'), 'Ё', 'Е'))
$$;

-- ---------- Функции ----------
drop function if exists
  public.request_initiator_info(bigint),
  public.set_my_mobile(text),
  public.add_department(text),
  public.set_my_department(smallint),
  public.initiator_profile(),
  public.initiator_request_card(bigint),
  public.initiator_requests(text),
  public.cancel_initiator_request(bigint),
  public.create_initiator_request(text, text, smallint, text, date, boolean, text, text, jsonb),
  public.assert_clean_text(text, text),
  public.require_initiator(),
  public.is_initiator(),
  public.current_initiator_id(),
  public.initiator_request_visible(bigint);

-- ---------- Фото и хранилище: как было ----------
create or replace function public.can_see_extra_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.is_manager() and exists (select 1 from extra_photos x where x.path = p_name or x.thumb_path = p_name))
      or (public.current_employee_id() is not null
          and exists (select 1 from extra_photos x where x.owner_kind = 'request' and (x.path = p_name or x.thumb_path = p_name)))
$$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists work_photos_insert_initiator on storage.objects;
  end if;
end $$;

-- ---------- Доступ к заявкам: как было (все вошедшие видят строки, колонки — через гранты) ----------
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated using (true);

-- ---------- Таблицы ----------
drop table if exists public.claim_attempts;
drop table if exists public.initiator_contacts;

-- ---------- Констрейнт source: как было ----------
alter table public.requests drop constraint if exists requests_source_check;
alter table public.requests add constraint requests_source_check check (source in ('manual', 'itsm'));

-- ---------- Колонки ----------
alter table public.requests
  drop column if exists urgent_reason,
  drop column if exists materials,
  drop column if exists place,
  drop column if exists department_id;
alter table public.employees
  drop column if exists ldap_code,
  drop column if exists work_phone,
  drop column if exists grade,
  drop column if exists department_id;
