#!/usr/bin/env bash
# Собирает пакет для сервера (скрипты + функции + secrets.env) и кладёт его в закрытую папку backups/move
# старого Supabase. Печатает текст для поля Cloud-init в Timeweb: ссылка на пакет действует 24 часа.
# Запускает Claude: bash infra/timeweb/make-bundle.sh api.example.ru
# Нужны переменные окружения SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD.
set -euo pipefail
DOMAIN=${1:?укажите домен сервера, например api.example.ru}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REF=$SUPABASE_PROJECT_REF
API="https://api.supabase.com/v1/projects/$REF"
AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

JWT_SECRET=$(curl -fsS "${AUTH[@]}" "$API/postgrest" | jq -r .jwt_secret)
KEYS=$(curl -fsS "${AUTH[@]}" "$API/api-keys?reveal=true")
ANON=$(jq -r '.[] | select(.type=="legacy" and .name=="anon") | .api_key' <<<"$KEYS")
SERVICE=$(jq -r '.[] | select(.type=="legacy" and .name=="service_role") | .api_key' <<<"$KEYS")
JWKS=$(curl -fsS "https://$REF.supabase.co/auth/v1/.well-known/jwks.json" | jq -c '{keys: [.keys[] | select(.kty != "oct")]}')
POOLER=$(curl -fsS "${AUTH[@]}" "$API/config/database/pooler" | jq -r '.[0].db_host')
PASS=$(jq -rn --arg p "$SUPABASE_DB_PASSWORD" '$p|@uri')
[ -n "$JWT_SECRET" ] && [ -n "$ANON" ] && [ -n "$SERVICE" ] && [ -n "$POOLER" ] || { echo "не удалось получить ключи"; exit 1; }

mkdir -p "$TMP/b"
cp -r "$ROOT/infra/timeweb/." "$TMP/b/"
rm -f "$TMP/b/make-bundle.sh"
mkdir -p "$TMP/b/app-functions" && cp -r "$ROOT/supabase/functions/." "$TMP/b/app-functions/"
umask 077
cat > "$TMP/b/secrets.env" <<ENV
DOMAIN=$DOMAIN
JWT_SECRET='$JWT_SECRET'
ANON_KEY=$ANON
SERVICE_ROLE_KEY=$SERVICE
OLD_JWKS='$JWKS'
# сессионный режим пулера (порт 5432) — нужен pg_dump
OLD_DB_URL=postgresql://postgres.$REF:$PASS@$POOLER:5432/postgres
OLD_URL=https://$REF.supabase.co
OLD_SERVICE_KEY=$SERVICE
ENV
NAME="move/bundle_$(date +%Y%m%d_%H%M%S).tgz"
tar czf "$TMP/bundle.tgz" -C "$TMP/b" .
curl -fsS -o /dev/null -X POST "https://$REF.supabase.co/storage/v1/object/backups/$NAME" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/gzip" --data-binary @"$TMP/bundle.tgz"
SIGNED=$(curl -fsS -X POST "https://$REF.supabase.co/storage/v1/object/sign/backups/$NAME" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" -d '{"expiresIn":86400}' | jq -r .signedURL)
URL="https://$REF.supabase.co/storage/v1$SIGNED"
echo "Пакет: backups/$NAME ($(du -h "$TMP/bundle.tgz" | cut -f1)), ссылка действует 24 часа."
echo
echo "----- Cloud-init (вставить целиком) -----"
cat <<CI
#!/bin/bash
mkdir -p /opt/uchet && cd /opt/uchet
curl -fsSL '$URL' -o /root/uchet.tgz && tar xzf /root/uchet.tgz -C /opt/uchet && rm -f /root/uchet.tgz
bash /opt/uchet/install.sh > /var/log/uchet-install.log 2>&1 && bash /opt/uchet/migrate.sh > /var/log/uchet-migrate.log 2>&1
CI
echo "-----------------------------------------"
