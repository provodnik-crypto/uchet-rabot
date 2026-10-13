-- Откат 20261014000003_request_comments.sql: переписка, непрочитанные, уведомления. Сообщения удаляются.
-- Списки (open_requests, my_requests, list_requests, request_card) вернуть из 20261014000002_request_lifecycle.sql.
begin;
drop function if exists public.my_notifications();
drop function if exists public.add_request_comment(bigint, text);
drop function if exists public.mark_request_read(bigint);
drop function if exists public.working_days_since(date);
delete from public.request_events where kind = 'comment';
alter table public.request_events drop constraint request_events_kind_check;
alter table public.request_events add constraint request_events_kind_check
  check (kind in ('take', 'refuse', 'send', 'accept', 'return', 'priority', 'assign', 'responsible', 'contractor', 'plan', 'migrate'));
alter table public.request_events alter column created_at set default now();
drop table public.request_reads;
-- request_unread используется списками — удалить после возврата их прежних определений:
-- drop function public.request_unread(bigint, bigint, boolean);
commit;
