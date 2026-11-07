-- Откат 20261023000002_extra_photos_read.sql
begin;
do $$ begin
  if to_regclass('storage.objects') is not null then execute 'drop policy if exists work_photos_extra_select on storage.objects'; end if;
end $$;
drop function public.can_see_extra_photo(text);
commit;
