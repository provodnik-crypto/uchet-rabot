-- Обезличивание: серверы за рубежом, хранить на них ФИО и фото сотрудников нельзя.
-- * сотрудник = имя + первая буква фамилии («Иван П.»); отображаемое имя собирает база,
--   одинаковые получают номер («Иван П. 2»);
-- * вместо фото — значок инструмента (1–12, рисунки в приложении), выдаётся автоматически;
-- * у заявки остаются только номер и тема.

-- ---------- Сотрудники ----------
alter table public.employees
  add column first_name text,
  add column last_initial text check (last_initial is null or last_initial ~ '^[А-ЯЁA-Z]$'),
  add column icon smallint check (icon is null or icon between 1 and 12);

update public.employees
   set first_name = case when role = 'service' then trim(display_name) else split_part(trim(display_name), ' ', 1) end,
       last_initial = case when role = 'service' then null
                           else nullif(upper(left(split_part(trim(display_name), ' ', 2), 1)), '') end;

alter table public.employees
  alter column first_name set not null,
  add constraint employees_first_name_check check (
    length(trim(first_name)) between 1 and 30 and (role = 'service' or first_name !~ '\s'));

alter table public.employees drop column nickname, drop column photo_path, drop column photo_thumb;

-- Отображаемое имя: «Имя Ф.»; если среди активных такое уже есть — «Имя Ф. 2», «Имя Ф. 3»…
create or replace function public.employees_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text;
  n int := 1;
begin
  new.first_name := trim(new.first_name);
  new.last_initial := nullif(upper(trim(coalesce(new.last_initial, ''))), '');
  if new.role <> 'service' then
    new.first_name := upper(left(new.first_name, 1)) || substr(new.first_name, 2);
  end if;
  base := new.first_name || coalesce(' ' || new.last_initial || '.', '');
  new.display_name := base;
  while new.is_active and exists (
    select 1 from employees e
    where e.is_active and lower(e.display_name) = lower(new.display_name) and e.id is distinct from new.id
  ) loop
    n := n + 1;
    new.display_name := base || ' ' || n;
  end loop;

  -- Значок: первый ещё не занятый активными сотрудниками; если заняты все — самый редкий.
  if new.icon is null and new.role <> 'service' then
    select i into new.icon
    from generate_series(1, 12) i
    order by (select count(*) from employees e where e.icon = i and e.is_active and e.id is distinct from new.id), i
    limit 1;
  end if;
  return new;
end $$;

create trigger employees_before_write
  before insert or update of first_name, last_initial, is_active, icon, display_name on public.employees
  for each row execute function public.employees_before_write();

-- Пересобрать имена и выдать значки существующим.
update public.employees set first_name = first_name where true;

-- Руководитель меняет имя, букву фамилии и значок; display_name собирается сам.
revoke update on public.employees from authenticated;
grant update (first_name, last_initial, icon) on public.employees to authenticated;
grant select (first_name, last_initial, icon) on public.employees to authenticated;

-- ---------- Заявки: только номер и тема ----------
drop function public.list_requests(text, integer);
alter table public.requests drop column requester, drop column registered_at, drop column state, drop column note;

create function public.list_requests(q text default '', p_limit integer default 100)
returns table (id bigint, number text, subject text, entries bigint, last_work_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return query
    select r.id, r.number, r.subject, count(e.id), max(s.work_date)
    from requests r
    left join work_entries e on e.request_id = r.id
    left join shifts s on s.id = e.shift_id
    where public.search_words_match(public.normalize_search(r.number || ' ' || coalesce(r.subject, '')), q)
    group by r.id
    order by max(s.work_date) desc nulls last, r.created_at desc
    limit least(greatest(p_limit, 1), 300);
end $$;
revoke all on function public.list_requests(text, integer) from public, anon;
grant execute on function public.list_requests(text, integer) to authenticated;

revoke insert, update on public.requests from authenticated;
grant insert (number, subject) on public.requests to authenticated;
grant update (subject) on public.requests to authenticated;

-- ---------- Фото сотрудников больше не храним ----------
-- Сами файлы удаляются через Storage API (прямое удаление из storage.objects запрещено),
-- здесь — только правило доступа.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'employee_photos_read') then
    execute 'drop policy employee_photos_read on storage.objects';
  end if;
end $$;
