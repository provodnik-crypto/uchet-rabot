#!/usr/bin/env bash
# Поднимает временный PostgreSQL, применяет миграции и запускает тесты.
# Запуск: bash supabase/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
work="$(mktemp -d)"
bin="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
trap '"$bin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

run_pg() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$work"; su postgres -c "$*"; else bash -c "$*"; fi; }
run_pg "'$bin/initdb' -D '$work/data' -U postgres -A trust >/dev/null"
run_pg "'$bin/pg_ctl' -D '$work/data' -o '-k $work -p 54329 -c listen_addresses=' -l '$work/log' start >/dev/null"
psql_cmd=(psql -h "$work" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -t)

"${psql_cmd[@]}" -f "$here/supabase_stub.sql"
for f in "$root"/migrations/*.sql; do "${psql_cmd[@]}" -f "$f"; done
# Прайс 2026 загружается тем же скриптом, что и в настоящую базу.
python3 "$root/scripts/price_2026_seed.py" 2>/dev/null | "${psql_cmd[@]}"
for t in "$here"/[0-9]*.sql; do
  echo "== $(basename "$t")"
  cat "$here/helpers.sql" "$t" | "${psql_cmd[@]}" 2>&1 | sed -n "s/^.*NOTICE:  /  /p; /ERROR\|ПРОВАЛ/p"
done
echo "Все тесты пройдены"
