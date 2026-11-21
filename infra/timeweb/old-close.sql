-- Выполнить на СТАРОМ Supabase сразу после переноса (Management API): приложение со старым адресом
-- получает «Сервер переехал» на любой запрос к базе — ничего не запишется в старое место.
create or replace function public.server_moved_guard() returns void
language plpgsql as $$
begin
  raise exception 'Сервер переехал. Закройте приложение и откройте снова — оно обновится.'
    using errcode = 'P0001', hint = 'server_moved';
end $$;
grant execute on function public.server_moved_guard() to anon, authenticated, service_role;
alter role authenticator set pgrst.db_pre_request = 'public.server_moved_guard';
notify pgrst, 'reload config';
-- расписание чистки фото на старом сервере больше не нужно
select cron.unschedule(jobid) from cron.job where jobname = 'photo-cleanup';
