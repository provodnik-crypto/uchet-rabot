#!/usr/bin/env bash
# Поднимает временный PostgreSQL, применяет миграции и запускает тесты.
# Запуск: bash supabase/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
work="$(mktemp -d)"
# Windows: portable PostgreSQL (initdb/pg_ctl/psql) кладётся в tools\pg; на Linux — пакеты дистрибутива.
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
win="$(uname -s | grep -qi mingw && echo yes || echo no)"
if [ "$win" = yes ]; then # у Windows-python stdout в cp1251 — SQL с «м²» падает без UTF-8
  export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
fi
if [ "$win" = yes ] && [ -z "$bin" ]; then bin="$(cygpath -m "$LOCALAPPDATA/../../tools/pg/bin" 2>/dev/null || true)"; fi
if [ "$win" = yes ]; then # у PostgreSQL для Windows нет unix-сокетов — слушаем локальный TCP
  host=127.0.0.1; listen="-c listen_addresses=127.0.0.1"
else
  host="$work"; listen="-c listen_addresses="
fi
trap 'rm -rf "$work"' EXIT

run_pg() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$work"; su postgres -c "$*"; else bash -c "$*"; fi; }
run_pg "'$bin/initdb' -D '$work/data' -U postgres -A trust -E UTF8 --no-locale >/dev/null"
# Файлы проекта в UTF-8; на Windows с русской локалью initdb иначе создаёт базу в WIN1251,
# UTF-8-миграции падают с «0x98 has no equivalent» и цикл миграций молча едет дальше.
export PGCLIENTENCODING=UTF8
if [ "$win" = yes ]; then
  # pg_ctl start в Git Bash не взлетает — запускаем postgres сами и ждём готовности
  wdata="$(cygpath -m "$work/data")"
  "$bin/postgres" -D "$wdata" -p 54329 -c listen_addresses=127.0.0.1 > "$work/log" 2>&1 < /dev/null &
  echo $! > "$work/pid"
  for i in $(seq 1 30); do
    if echo 'select 1' | psql -h "$host" -p 54329 -U postgres -d postgres -q >/dev/null 2>&1; then break; fi
    sleep 1
  done
else
  run_pg "'$bin/pg_ctl' -D '$work/data' -o '-k $work -p 54329 $listen' -l '$work/log' start >/dev/null"
fi
psql_cmd=(psql -h "$host" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -t)

"${psql_cmd[@]}" -f "$here/supabase_stub.sql"
for f in "$root"/migrations/*.sql; do "${psql_cmd[@]}" -f "$f"; done
# Прайс 2026 загружается тем же скриптом, что и в настоящую базу.
python3 "$root/scripts/price_2026_seed.py" 2>/dev/null | "${psql_cmd[@]}"
fail=0
for t in "$here"/[0-9]*.sql; do
  echo "== $(basename "$t")"
  # Мастер не создаёт заявки (с 23.10.2026): номера, которые тест вносит в смену, заводим заранее — как руководитель.
  nums=$(grep -oiE "'request_number', '(RFS|INC)[0-9]{6}_[0-9]{4}'" "$t" | grep -oiE "(RFS|INC)[0-9]{6}_[0-9]{4}" | tr a-z A-Z | sort -u | grep -vxF -f <(grep -oE '"number": "[A-Z0-9_]+"' "$t" | grep -oE "(RFS|INC)[0-9_]+" || true) | sed "s/.*/('&')/" | paste -sd, - || true)
  pre=""
  [ -n "$nums" ] && pre="insert into public.requests (number) values $nums on conflict (number) do nothing;"
  # Тесты до 23-го проверяют расчёт денег через старую «Закрыть смену» — им разрешено её прежнее поведение.
  legacy=""
  [ "$(basename "$t" | cut -c1-2)" -le 23 ] && legacy="select set_config('uchet.allow_legacy_shift', 'on', false);"
  # Провал = маркер «ПРОВАЛ» ИЛИ ненулевой exit psql (ON_ERROR_STOP рвёт файл до маркера —
  # так тест 36 «проходил» ложно, пока констрейнт source не знал 'initiator').
  out=$( { cat "$here/helpers.sql"; echo "$legacy"; echo "$pre"; cat "$t"; } | "${psql_cmd[@]}" 2>&1 ) || true
  rc=$(printf '%s' "$out" | grep -c 'ПРОВАЛ' || true)
  err=$(printf '%s' "$out" | grep -c '^psql.*ERROR\|^ERROR' || true)
  printf '%s\n' "$out" | sed -n "s/^.*NOTICE:  /  /p; /ERROR\|ПРОВАЛ/p"
  if [ "${rc:-0}" -gt 0 ] || [ "${err:-0}" -gt 0 ]; then
    echo "FAIL: $(basename "$t")"
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then echo "ЕСТЬ ПРОВАЛЫ"; exit 1; fi
echo "Все тесты пройдены"
