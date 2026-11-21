#!/usr/bin/env bash
# Установка сервера «Учёт работ» на чистый Ubuntu 24.04 (Timeweb Cloud). Запуск от root: bash /opt/uchet/install.sh
# Повторный запуск безопасен: пароли и данные не пересоздаются.
# Рядом должны лежать: docker-compose.yml, Caddyfile, supabase/, functions/, secrets.env (его даёт Claude, в git его нет).
set -euo pipefail
cd "$(dirname "$0")"
DIR=$(pwd)
say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОШИБКА: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "запустите от root"
[ -f secrets.env ] || die "нет файла secrets.env"
set -a; . ./secrets.env; set +a
[ -n "${DOMAIN:-}" ] && [ -n "${JWT_SECRET:-}" ] && [ -n "${ANON_KEY:-}" ] && [ -n "${SERVICE_ROLE_KEY:-}" ] || die "secrets.env неполный"

# UCHET_REHEARSAL=1 — репетиция на машине Claude: система не настраивается, только сервер в Docker
if [ "${UCHET_REHEARSAL:-}" != 1 ]; then
say "1/7 Обновление системы и программы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 jq curl ufw unattended-upgrades ca-certificates
# Зеркало Docker Hub у Timeweb: образы скачиваются из России, при сбое — напрямую
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://dockerhub.timeweb.cloud"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker
# Автообновления безопасности Ubuntu (перезагрузка — ночью, если обновление её требует)
cat > /etc/apt/apt.conf.d/52uchet-upgrades <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF
systemctl enable --now unattended-upgrades || true

say "2/7 Файл подкачки и защита портов"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
timedatectl set-timezone Asia/Yekaterinburg || true
fi

say "3/7 Пароли сервера"
gen() { openssl rand -hex 24; }
if [ ! -f .env ]; then
  # JWKS: прежний секрет (HS256) + открытый ключ прежнего Supabase — принимаются входы, выданные до переезда
  K=$(printf '%s' "$JWT_SECRET" | base64 -w0 | tr '+/' '-_' | tr -d '=')
  [ -n "${OLD_JWKS:-}" ] || OLD_JWKS='{"keys":[]}'
  JWKS=$(jq -cn --arg k "$K" --argjson old "$OLD_JWKS" '{keys: ([{kty:"oct",k:$k,alg:"HS256"}] + $old.keys)}')
  umask 077
  cat > .env <<ENV
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(gen)
JWT_SECRET=$JWT_SECRET
JWT_JWKS='$JWKS'
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
PG_META_CRYPTO_KEY=$(gen)
DASHBOARD_USERNAME=uchet
DASHBOARD_PASSWORD=$(gen)
CRON_SECRET=$(gen)
ENV
fi
chmod 600 .env secrets.env

say "4/7 Серверные функции"
mkdir -p functions data/storage backups
rm -rf functions/main && cp -r supabase/functions-main functions/main
[ -d app-functions ] && cp -r app-functions/. functions/

say "5/7 Скачивание программ (несколько минут)"
docker compose pull -q

say "6/7 Запуск"
docker compose up -d
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8000/auth/v1/health -H "apikey: $ANON_KEY"; then break; fi
  sleep 5
  [ "$i" = 60 ] && { docker compose ps; die "сервер не запустился за 5 минут"; }
done
echo "Сервер отвечает."

[ "${UCHET_REHEARSAL:-}" = 1 ] && { echo "Репетиция: сервер запущен."; exit 0; }

say "7/7 Ежедневная копия базы (03:15, хранится 7 дней)"
cat > /etc/cron.d/uchet-backup <<CRON
15 3 * * * root cd $DIR && docker compose exec -T db pg_dump -U supabase_admin -d postgres -Fc -f /backups/db_\$(date +\%F).dump && find $DIR/backups -name 'db_*.dump' -mtime +7 -delete
CRON

MYIP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
DNSIP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')
echo
if [ "$MYIP" = "$DNSIP" ]; then
  if curl -fsS -o /dev/null --max-time 60 "https://$DOMAIN/auth/v1/health" -H "apikey: $ANON_KEY"; then
    echo "ГОТОВО: https://$DOMAIN работает."
  else
    echo "Сервер запущен. Сертификат для https://$DOMAIN ещё получается — проверьте через 5 минут."
  fi
else
  echo "Сервер запущен, но домен $DOMAIN указывает на ${DNSIP:-«никуда»}, а IP сервера $MYIP."
  echo "Проверьте запись A у домена; https заработает сам, когда она обновится."
fi
