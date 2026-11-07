-- Откат 20261021000002_comment_edit.sql: без исправления и удаления сообщений.
-- Удалённые сообщения останутся пустыми (текст уже стёрт); исправленные — с новым текстом.
begin;
drop function public.edit_request_comment(bigint, text);
drop function public.delete_request_comment(bigint);
do $$
declare d text;
begin
  d := pg_get_functiondef('public.request_card(bigint, text)'::regprocedure);
  d := replace(d, $r$jsonb_build_object('id', ev.id, 'edited', ev.edited_at is not null, 'deleted', ev.deleted_at is not null,
                                          'kind', ev.kind, 'at', ev.created_at,$r$, $r$jsonb_build_object('kind', ev.kind, 'at', ev.created_at,$r$);
  execute d;
  d := pg_get_functiondef('public.request_unread(bigint, bigint, boolean)'::regprocedure);
  d := replace(d, 'and ev.author_id is distinct from p_me and ev.deleted_at is null', 'and ev.author_id is distinct from p_me');
  execute d;
end $$;
alter table public.request_events drop column edited_at, drop column deleted_at, drop column deleted_by;
commit;
notify pgrst, 'reload schema';
