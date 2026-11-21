-- Фото результата заявки и фото из «Сообщить руководителю» (extra_photos) видит руководитель
-- (автор и так видит свою папку). Политика хранилища вызывает функцию с правами владельца.
-- Откат: supabase/rollback/20261023000002_extra_photos_read_down.sql
create function public.can_see_extra_photo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() and exists (select 1 from extra_photos x where x.path = p_name or x.thumb_path = p_name)
$$;
revoke all on function public.can_see_extra_photo(text) from public, anon;
grant execute on function public.can_see_extra_photo(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$create policy work_photos_extra_select on storage.objects for select to authenticated
      using (bucket_id = 'work-photos' and public.can_see_extra_photo(name))$p$;
  end if;
end $$;
