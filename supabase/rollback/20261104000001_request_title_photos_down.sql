-- Откат 20261104000001_request_title_photos. Изменённые названия остаются (operation), фото, добавленные в карточке, — тоже.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.request_card(bigint,text)'::regprocedure);
  n := replace(d, $r$
    'can_edit_title', public.can_edit_request_title(r.id), 'title_edited_at', r.title_edited_at,$r$, '');
  if n <> d then execute n; end if;
end $$;
create or replace function public.request_extras(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_employee_id() is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  return (select jsonb_build_object(
      'contact_phone', r.contact_phone,
      'photos', coalesce((select jsonb_agg(jsonb_build_object('path', x.path, 'thumb_path', x.thumb_path) order by x.position)
                          from extra_photos x where x.owner_kind = 'request' and x.owner_id = r.id), '[]'::jsonb))
    from requests r where r.id = p_id);
end $$;
drop function if exists public.delete_request_photo(bigint);
drop function if exists public.add_request_photos(bigint, jsonb);
drop function if exists public.set_request_title(bigint, text);
drop function if exists public.can_edit_request_title(bigint);
alter table public.requests drop column if exists title_edited_at;
alter table public.requests drop column if exists title_edited_by;
