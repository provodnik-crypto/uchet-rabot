-- Откат 20261014000002_request_lifecycle.sql. Работы «Ждёт приёмки» становятся «Принято» (идут в суммы, как раньше).
begin;
update public.work_entries set status = 'priced' where status = 'awaiting';
drop trigger if exists work_entries_acceptance on public.work_entries;
drop function if exists public.work_entries_acceptance();
alter table public.work_entries drop column needs_acceptance;
alter table public.work_entries drop constraint work_entries_status_check;
alter table public.work_entries add constraint work_entries_status_check check (status in ('priced', 'pending', 'rejected'));

drop function public.submit_shift(jsonb);
alter function public.submit_shift_core(jsonb) rename to submit_shift;
grant execute on function public.submit_shift(jsonb) to authenticated;

drop function if exists public.take_request(bigint, integer, bigint[]);
drop function if exists public.refuse_request(bigint, text);
drop function if exists public.send_request_for_review(bigint, text);
drop function if exists public.accept_request(bigint, text);
drop function if exists public.return_request(bigint, text);
drop function if exists public.set_request_priority(bigint, smallint);
drop function if exists public.set_request_responsible(bigint, bigint);
drop function if exists public.my_requests();
drop function if exists public.review_count();
drop function if exists public.claim_request_for_work(bigint, bigint);
drop function if exists public.log_request_event(bigint, text, text, text, text);
drop function if exists public.minutes_label(integer);
drop trigger if exists requests_sync_state on public.requests;
drop function if exists public.requests_sync_state();
drop table public.request_events;
drop table public.request_members;
-- open_requests, list_requests, request_card, my_open_requests, save_shift_requests, assign_request,
-- refresh_request_state, my_month_summary: вернуть определения из 20261012000001, 20261013000001, 20261013000002,
-- 20261014000001 (выполнить эти части миграций заново) — до этого приложение прежней версии работать не будет.
alter table public.requests drop constraint if exists requests_responsible_status;
alter table public.requests drop column status, drop column responsible_id, drop column taken_at, drop column sent_at,
  drop column priority, drop column returned_comment, drop column last_activity_at;
commit;
