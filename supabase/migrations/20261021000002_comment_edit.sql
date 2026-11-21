-- Исправить или удалить сообщение в переписке по заявке.
-- Своё сообщение автор может исправить или удалить; руководитель может удалить любое.
-- Удалённое не стирается из истории: текст убирается, в ленте — «Сообщение удалено» (кто и когда — в deleted_by/at).
-- Исправленное помечается «(изменено)». В непрочитанные удалённые не считаются.
-- Только добавляет: старое приложение работает (удалённое покажет пустым пузырём до обновления).
-- Откат: supabase/rollback/20261021000002_comment_edit_down.sql
alter table public.request_events
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add column deleted_by bigint references public.employees(id);

create function public.edit_request_comment(p_event bigint, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id(); ev request_events;
begin
  if me is null then raise exception 'Нет доступа'; end if;
  if length(trim(coalesce(p_text, ''))) = 0 then raise exception 'Напишите сообщение'; end if;
  if length(trim(p_text)) > 1000 then raise exception 'Сообщение длиннее 1000 знаков'; end if;
  select * into ev from request_events where id = p_event and kind = 'comment' for update;
  if ev.id is null or ev.deleted_at is not null then raise exception 'Сообщение не найдено'; end if;
  if ev.author_id is distinct from me then raise exception 'Исправить можно только своё сообщение'; end if;
  if ev.comment is not distinct from trim(p_text) then return; end if;
  update request_events set comment = trim(p_text), edited_at = now() where id = p_event;
end $$;

create function public.delete_request_comment(p_event bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me bigint := public.current_employee_id(); ev request_events;
begin
  if me is null then raise exception 'Нет доступа'; end if;
  select * into ev from request_events where id = p_event and kind = 'comment' for update;
  if ev.id is null or ev.deleted_at is not null then raise exception 'Сообщение не найдено'; end if;
  if ev.author_id is distinct from me and not public.is_manager() then
    raise exception 'Удалить чужое сообщение может только руководитель';
  end if;
  update request_events set comment = null, deleted_at = now(), deleted_by = me where id = p_event;
end $$;

revoke all on function public.edit_request_comment(bigint, text) from public, anon;
grant execute on function public.edit_request_comment(bigint, text) to authenticated;
revoke all on function public.delete_request_comment(bigint) from public, anon;
grant execute on function public.delete_request_comment(bigint) to authenticated;

do $$
declare
  d text; n text; f text;
  pairs text[][] := array[
    array['public.request_card(bigint, text)', $r$jsonb_build_object('kind', ev.kind, 'at', ev.created_at,$r$,
          $r$jsonb_build_object('id', ev.id, 'edited', ev.edited_at is not null, 'deleted', ev.deleted_at is not null,
                                          'kind', ev.kind, 'at', ev.created_at,$r$],
    array['public.request_unread(bigint, bigint, boolean)', 'and ev.author_id is distinct from p_me',
          'and ev.author_id is distinct from p_me and ev.deleted_at is null']
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
notify pgrst, 'reload schema';
