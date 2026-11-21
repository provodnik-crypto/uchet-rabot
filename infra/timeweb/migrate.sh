#!/usr/bin/env bash
# Перенос данных со старого Supabase на этот сервер. Запуск от root: bash /opt/uchet/migrate.sh
# Каждый запуск начинает с ЧИСТОЙ базы этого сервера: всё, что было на нём, заменяется данными старого.
# Старый Supabase только читается — там ничего не меняется.
set -euo pipefail
cd "$(dirname "$0")"
DIR=$(pwd)
say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОШИБКА: %s\033[0m\n' "$*"; exit 1; }
dc() { docker compose "$@"; }

[ "$(id -u)" = 0 ] || die "запустите от root"
[ -f .env ] || die "сначала install.sh"
set -a; . ./secrets.env; . ./.env; set +a
[ -n "${OLD_DB_URL:-}" ] && [ -n "${OLD_URL:-}" ] && [ -n "${OLD_SERVICE_KEY:-}" ] || die "в secrets.env нет данных старого сервера"
NEW=http://127.0.0.1:8000
W=backups/move_$(date +%F_%H%M)
mkdir -p "$W"
old() { dc exec -T db psql "$OLD_DB_URL" -v ON_ERROR_STOP=1 -X -q -At "$@"; }
new() { dc exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X -q -At "$@"; }

say "1/8 Связь со старой базой"
old -c "select 'заявок: ' || count(*) from public.requests" || die "старая база не отвечает"

say "2/8 Выгрузка со старой базы"
# Как «supabase db dump» (github.com/supabase/cli, pkg/migration/scripts): схема без служебных схем, данные отдельно.
INTERNAL='information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault'
# данные: + auth (сотрудники и их входы); фото и папки переносятся отдельно через хранилище
DATA_EXCL='information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor|storage|cron|net|supabase_functions|pgmq'
dc exec -T db pg_dump "$OLD_DB_URL" --schema-only --quote-all-identifier --role postgres --exclude-schema "$INTERNAL" \
| sed -E 's/^\\(un)?restrict .*$/-- &/' \
| sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' \
| sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
| sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' \
| sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' \
| sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' \
| sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' \
| sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' \
| sed -E 's/^CREATE EVENT TRIGGER /-- &/' \
| sed -E 's/^         WHEN TAG IN /-- &/' \
| sed -E 's/^   EXECUTE FUNCTION /-- &/' \
| sed -E 's/^ALTER EVENT TRIGGER /-- &/' \
| sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' \
| sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' \
| sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' \
| sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' \
| sed -E "s/^GRANT (.+) ON (.+) \"(${INTERNAL})\"/-- &/" \
| sed -E "s/^REVOKE (.+) ON (.+) \"(${INTERNAL})\"/-- &/" \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\1;/' \
| sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' \
| sed -E 's/^CREATE POLICY "cron_job_/-- &/' \
| sed -E 's/^ALTER TABLE "cron"/-- &/' \
| sed -E 's/^SET transaction_timeout = 0;/-- &/' \
> "$W/schema.sql"
{
  echo "SET session_replication_role = replica;"
  dc exec -T db pg_dump "$OLD_DB_URL" --data-only --quote-all-identifier --role postgres --column-inserts --rows-per-insert 500 \
    --schema '*' --exclude-schema "$DATA_EXCL" --exclude-table auth.schema_migrations \
  | sed -E 's/^\\(un)?restrict .*$/-- &/'
  echo "RESET ALL;"
} > "$W/data.sql"
# правила доступа к фото (схема storage в выгрузку не входит); search_path пустой — имена в правилах полные
old -c "set search_path = ''; select format('create policy %I on storage.objects as %s for %s to %s%s%s;',
          policyname, permissive, cmd, (select string_agg(quote_ident(r), ', ') from unnest(roles) r),
          coalesce(' using (' || qual || ')', ''), coalesce(' with check (' || with_check || ')', ''))
        from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname" > "$W/storage_policies.sql"
old -c "select coalesce(json_agg(json_build_object('id', id, 'name', name, 'public', public,
          'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types)), '[]') from storage.buckets" > "$W/buckets.json"
old -c "select bucket_id || '/' || name || chr(9) || coalesce(metadata->>'mimetype', 'application/octet-stream')
        from storage.objects order by 1" > "$W/objects.tsv"
old -c "select string_agg(format('select %L, count(*) from %I.%I', schemaname || '.' || tablename, schemaname, tablename), ' union all ' order by schemaname, tablename)
        from pg_tables where schemaname in ('public', 'backup_20261018')" > "$W/count.sql"
echo "  схема: $(wc -l < "$W/schema.sql") строк, данные: $(du -h "$W/data.sql" | cut -f1), правил фото: $(wc -l < "$W/storage_policies.sql"), файлов: $(wc -l < "$W/objects.tsv")"

say "3/8 Чистая база на этом сервере"
dc stop
dc rm -f
rm -rf data/db data/storage
mkdir -p data/storage
dc up -d
for i in $(seq 1 60); do
  # auth и storage при запуске создают свои таблицы — ждём, пока оба ответят
  if curl -fsS -o /dev/null "$NEW/auth/v1/health" -H "apikey: $ANON_KEY" \
     && curl -fsS -o /dev/null "$NEW/storage/v1/bucket" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"; then break; fi
  sleep 5
  [ "$i" = 60 ] && { dc ps; die "сервер не запустился"; }
done

say "4/8 Схема базы"
new -c "create extension if not exists pg_net with schema extensions; create extension if not exists pg_cron;" >/dev/null
new --single-transaction -q -f "/backups/${W#backups/}/schema.sql" >/dev/null

say "5/8 Данные"
new --single-transaction -q -f "/backups/${W#backups/}/data.sql" >/dev/null

say "6/8 Настройки: таймауты, правила фото, расписание"
new --single-transaction -q >/dev/null <<SQL
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
alter role authenticator set statement_timeout = '8s';
alter role authenticator set lock_timeout = '8s';
\i /backups/${W#backups/}/storage_policies.sql
select vault.create_secret('$CRON_SECRET', 'cron_secret');
select cron.schedule('photo-cleanup', '*/15 * * * *', \$job\$
  select net.http_post(
    url := 'http://api-gw:8000/functions/v1/photo-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer $ANON_KEY',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
\$job\$);
notify pgrst, 'reload schema';
SQL

say "7/8 Папки и фото"
H=(-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
jq -c '.[]' "$W/buckets.json" | while read -r b; do
  curl -fsS -o /dev/null "${H[@]}" -H "Content-Type: application/json" -X POST "$NEW/storage/v1/bucket" -d "$b" \
    || die "папка $(jq -r .id <<<"$b") не создалась"
done
TMP=$(mktemp); FAILED=0; N=0
while IFS=$'\t' read -r path mime; do
  [ -n "$path" ] || continue
  N=$((N + 1))
  enc=$(jq -rn --arg p "$path" '$p | split("/") | map(@uri) | join("/")')
  if curl -fsS -o "$TMP" -H "apikey: $OLD_SERVICE_KEY" -H "Authorization: Bearer $OLD_SERVICE_KEY" "$OLD_URL/storage/v1/object/$enc" \
     && curl -fsS -o /dev/null "${H[@]}" -H "Content-Type: $mime" -H "x-upsert: true" --data-binary @"$TMP" "$NEW/storage/v1/object/$enc"; then
    :
  else
    FAILED=$((FAILED + 1)); echo "  не перенёсся: $path"
  fi
done < "$W/objects.tsv"
rm -f "$TMP"
echo "  файлов: $N, не перенеслось: $FAILED"

say "8/8 Сверка старой и новой базы"
SQL_COUNT="$(cat "$W/count.sql") union all select 'auth.users', count(*) from auth.users union all select 'storage.objects', count(*) from storage.objects"
old -F $'\t' -c "$SQL_COUNT" | sort > "$W/count_old.tsv"
new -F $'\t' -c "$SQL_COUNT" | sort > "$W/count_new.tsv"
if diff "$W/count_old.tsv" "$W/count_new.tsv" > "$W/count_diff.txt"; then
  echo "  все $(wc -l < "$W/count_old.tsv") таблиц совпадают"
else
  echo "  РАСХОЖДЕНИЯ (слева старая база, справа новая):"; cat "$W/count_diff.txt"; FAILED=$((FAILED + 1))
fi
rm -f "$W/data.sql"   # данные уже в базе; копия базы делается каждую ночь
[ "$FAILED" = 0 ] || die "перенос с ошибками — пришлите Claude снимок экрана"
printf '\n\033[1;32mПЕРЕНОС ЗАВЕРШЁН БЕЗ ОШИБОК.\033[0m Напишите Claude: «перенос готов».\n'
