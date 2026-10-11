-- Расписания на сервере (выполнить один раз; повторный запуск безопасен).
-- Пароль для вызова серверных функций по расписанию хранится в Vault под именем cron_secret
-- (тот же пароль задан функциям как секрет CRON_SECRET).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'photo-cleanup';
select cron.schedule(
  'photo-cleanup',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://lslqcrcxpvavqqrnayde.supabase.co/functions/v1/photo-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
  $job$
);
