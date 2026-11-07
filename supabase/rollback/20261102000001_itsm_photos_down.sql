-- Откат 20261102000001_itsm_photos. Записи фото заявок удаляются (файлы уберёт ночная чистка), телефоны — тоже.
create or replace function public.can_see_extra_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() and exists (select 1 from extra_photos x where x.path = p_name or x.thumb_path = p_name)
$$;
drop function if exists public.request_photo_ids();
drop function if exists public.request_extras(bigint);
drop function if exists public.set_request_phones(jsonb);
drop function if exists public.requests_with_photos(text[]);
drop function if exists public.attach_request_photos(text, jsonb);
delete from public.extra_photos where owner_kind = 'request';
alter table public.extra_photos drop constraint extra_photos_owner_kind_check;
alter table public.extra_photos add constraint extra_photos_owner_kind_check check (owner_kind in ('result', 'report'));
alter table public.requests drop column if exists contact_phone;
