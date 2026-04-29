#!/usr/bin/env bash
# Восстановление nginx-конфига bananoboom.ru + добавление MAX webhook роута.
# Идемпотентный: безопасно запускать несколько раз.
#
# Запуск:
#   cd /opt/bot_max && sudo bash scripts/setup-webhook.sh
#
# Что делает:
#   1. Бэкапит текущий /etc/nginx/sites-available/bananoboom.ru
#   2. Записывает восстановленный конфиг (база из certbot-бэкапа + tbank/max routes)
#   3. Тестирует nginx -t, перезагружает nginx
#   4. Добавляет в .env переменные MAX_* (USE_WEBHOOK=false по умолчанию)
#   5. Пересобирает TS, перезапускает bot-max.service (всё ещё polling)
#   6. Тестирует /api/max/webhook curl-ом снаружи
#
# После выполнения переключение в webhook-режим — отдельным шагом
# (см. инструкции в конце вывода скрипта).

set -euo pipefail

CONFIG_PATH="/etc/nginx/sites-available/bananoboom.ru"
SYMLINK_PATH="/etc/nginx/sites-enabled/bananoboom.ru"
ENV_PATH="/opt/bot_max/.env"
SECRET_FILE="/root/.max-webhook-secret"
DOMAIN="bananoboom.ru"
WEBHOOK_PUBLIC_URL="https://${DOMAIN}/api/max/webhook"
TS=$(date +%Y%m%d-%H%M%S)

step() { echo ""; echo "── $1 ──"; }
ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠ $1"; }
err()  { echo "  ✗ $1"; }

# ──────────────────────────────────────────────────────────────
step "[1/7] Восстановление nginx-конфига"

# Бэкап текущего файла (даже если он пустой — пусть будет в истории)
if [ -f "$CONFIG_PATH" ]; then
  cp "$CONFIG_PATH" "${CONFIG_PATH}.bak.${TS}"
  ok "Бэкап старого: ${CONFIG_PATH}.bak.${TS}"
fi

cat > "$CONFIG_PATH" << 'NGINX_EOF'
# /etc/nginx/sites-available/bananoboom.ru
# Восстановлен после случайного очищения файла (см. scripts/setup-webhook.sh).
# База — бэкап certbot, плюс роуты:
#   • /api/tbank/notify  → 127.0.0.1:8787/tbank/notify  (T-Bank webhook)
#   • /api/max/webhook   → 127.0.0.1:8787/max/webhook   (MAX bot webhook)

server {
    server_name bananoboom.ru www.bananoboom.ru;

    listen 80;
    listen [::]:80;

    # ACME challenge для автообновления Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    root /var/www/bananoboom;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # ── T-Bank notify ─────────────────────────────────────────
    location = /api/tbank/notify {
        proxy_pass http://127.0.0.1:8787/tbank/notify;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 1M;
        proxy_read_timeout 30s;
    }

    # ── MAX bot webhook ───────────────────────────────────────
    location = /api/max/webhook {
        proxy_pass http://127.0.0.1:8787/max/webhook;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Пробрасываем заголовок секрета — без него /max/webhook ответит 403
        proxy_set_header X-Max-Bot-Api-Secret $http_x_max_bot_api_secret;
        client_max_body_size 1M;
        proxy_read_timeout 30s;
    }

    # ── SSL (managed by Certbot) ──────────────────────────────
    listen [::]:443 ssl ipv6only=on;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/bananoboom.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bananoboom.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
NGINX_EOF

ok "Записан новый $CONFIG_PATH ($(wc -l < "$CONFIG_PATH") строк)"

# Симлинк sites-enabled — на всякий случай
if [ ! -L "$SYMLINK_PATH" ]; then
  ln -sf "$CONFIG_PATH" "$SYMLINK_PATH"
  ok "Создан симлинк $SYMLINK_PATH"
else
  ok "Симлинк sites-enabled уже на месте"
fi

# ──────────────────────────────────────────────────────────────
step "[2/7] Тест nginx -t"

if nginx -t 2>&1; then
  ok "Конфиг валиден"
else
  err "nginx -t упал. Бэкап остался в ${CONFIG_PATH}.bak.${TS}"
  exit 1
fi

# ──────────────────────────────────────────────────────────────
step "[3/7] Reload nginx"

systemctl reload nginx
ok "nginx перезагружен"

# Проверка что сайт реально жив
HTTPCODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" --max-time 10 || echo "ERR")
if [ "$HTTPCODE" = "200" ] || [ "$HTTPCODE" = "404" ] || [ "$HTTPCODE" = "403" ]; then
  ok "Сайт отвечает (HTTP $HTTPCODE)"
else
  warn "Сайт вернул неожиданный код: $HTTPCODE (но bot/webhook это не блокирует)"
fi

# ──────────────────────────────────────────────────────────────
step "[4/7] Секрет webhook + .env переменные"

if [ ! -f "$SECRET_FILE" ]; then
  openssl rand -hex 32 > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  ok "Секрет сгенерирован: $SECRET_FILE"
else
  ok "Секрет уже существует: $SECRET_FILE"
fi
SECRET=$(cat "$SECRET_FILE")

if grep -q "^MAX_USE_WEBHOOK=" "$ENV_PATH"; then
  ok "MAX_* переменные уже есть в .env (не трогаю)"
else
  cat >> "$ENV_PATH" << EOF

# ─── MAX webhook ────────────────────────────────────────────
# Включить после того как nginx-роут протестирован.
MAX_USE_WEBHOOK=false
MAX_WEBHOOK_URL=${WEBHOOK_PUBLIC_URL}
MAX_WEBHOOK_PATH=/max/webhook
MAX_WEBHOOK_SECRET=${SECRET}
EOF
  ok "Добавлены MAX_* переменные в .env (USE_WEBHOOK=false для безопасности)"
fi

# ──────────────────────────────────────────────────────────────
step "[5/7] Сборка TypeScript"

cd /opt/bot_max
if npm run build > /tmp/setup-webhook-build.log 2>&1; then
  ok "tsc OK"
else
  err "Сборка упала. Лог: /tmp/setup-webhook-build.log"
  tail -20 /tmp/setup-webhook-build.log
  exit 1
fi

# ──────────────────────────────────────────────────────────────
step "[6/7] Перезапуск bot-max.service"

systemctl restart bot-max.service
sleep 3
if systemctl is-active --quiet bot-max.service; then
  ok "Бот запустился"
  echo ""
  echo "  Последние строки лога:"
  journalctl -u bot-max.service -n 10 --no-pager | sed 's/^/    /'
else
  err "Бот не запустился! Лог:"
  journalctl -u bot-max.service -n 20 --no-pager
  exit 1
fi

# ──────────────────────────────────────────────────────────────
step "[7/7] Внешний curl-тест /api/max/webhook"

echo "  Сейчас MAX_USE_WEBHOOK=false → ожидаем HTTP 404 (бот не знает route)"
sleep 2
HTTPCODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "https://${DOMAIN}/api/max/webhook" \
  -H "X-Max-Bot-Api-Secret: ${SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"test":1}' --max-time 10 || echo "ERR")
echo "  Код ответа: HTTP $HTTPCODE"
case "$HTTPCODE" in
  404) ok "ОЖИДАНИЕ ОПРАВДАЛОСЬ (бот в polling-режиме)" ;;
  403) warn "Получили 403 — секрет не пробрасывается nginx-ом? Проверь конфиг" ;;
  502) err "502 Bad Gateway — бот не слушает 127.0.0.1:8787, проверь systemctl status" ;;
  200) warn "Получили 200 — webhook уже включён? Если да — отлично" ;;
  *)   warn "Неожиданный код: $HTTPCODE" ;;
esac

# ──────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo " ГОТОВО"
echo "================================================================"
echo ""
echo "Что сделано:"
echo "  ✓ /etc/nginx/sites-available/bananoboom.ru восстановлен"
echo "  ✓ Добавлены роуты /api/tbank/notify и /api/max/webhook"
echo "  ✓ Бот пересобран и работает (всё ещё в POLLING-режиме)"
echo "  ✓ В .env добавлены MAX_* переменные (USE_WEBHOOK=false)"
echo ""
echo "Чтобы переключить бот в WEBHOOK-режим:"
echo "  1. sudo sed -i 's/^MAX_USE_WEBHOOK=false/MAX_USE_WEBHOOK=true/' $ENV_PATH"
echo "  2. sudo systemctl restart bot-max.service"
echo "  3. sudo journalctl -u bot-max.service -f"
echo "     Должно появиться: 'Bot is running in WEBHOOK mode'"
echo ""
echo "Чтобы откатиться обратно в polling:"
echo "  1. sudo sed -i 's/^MAX_USE_WEBHOOK=true/MAX_USE_WEBHOOK=false/' $ENV_PATH"
echo "  2. sudo systemctl restart bot-max.service"
echo ""
echo "Секрет webhook: $SECRET_FILE (chmod 600, не коммить!)"
echo "Публичный URL: $WEBHOOK_PUBLIC_URL"
