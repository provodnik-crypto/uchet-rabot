-- Откат переезда: снова открыть старый Supabase (обратное к old-close.sql); затем выполнить supabase/scripts/setup_cron.sql
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
drop function if exists public.server_moved_guard();
