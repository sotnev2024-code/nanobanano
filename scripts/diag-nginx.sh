#!/usr/bin/env bash
# Диагностика nginx-конфига для bananoboom.ru.
# Запуск: sudo bash scripts/diag-nginx.sh > /tmp/diag-out.txt 2>&1
# После — пришли содержимое /tmp/diag-out.txt в чат.

set +e  # не падать на ошибках, нам важна вся информация

echo "================================================================"
echo " DIAG: $(date -Iseconds)"
echo "================================================================"

echo ""
echo "─── 1. Текущее состояние файла bananoboom.ru ───"
ls -la /etc/nginx/sites-available/bananoboom.ru 2>&1
echo "Содержимое (если есть):"
cat /etc/nginx/sites-available/bananoboom.ru 2>&1 | head -200
echo "(конец файла)"

echo ""
echo "─── 2. Бэкапы Let's Encrypt (там обычно лежит pre-SSL конфиг) ───"
ls -la /var/lib/letsencrypt/backups/ 2>&1
for d in /var/lib/letsencrypt/backups/*/; do
  echo ""
  echo "▶ Каталог: $d"
  ls -la "$d" 2>&1
  for f in "$d"bananoboom.ru* "$d"*.conf "$d"*nginx*; do
    if [ -f "$f" ]; then
      echo ""
      echo "  ── Файл: $f ──"
      cat "$f" 2>&1 | head -200
      echo "  (конец $f)"
    fi
  done
done

echo ""
echo "─── 3. Сертификаты Let's Encrypt ───"
ls -la /etc/letsencrypt/live/bananoboom.ru/ 2>&1
echo ""
echo "─── 4. Renewal-конфиг ───"
cat /etc/letsencrypt/renewal/bananoboom.ru.conf 2>&1

echo ""
echo "─── 5. Что сейчас активно в nginx (память) ───"
nginx -T 2>&1 | grep -E "server_name|listen|location|proxy_pass" | head -40

echo ""
echo "─── 6. Все .bak / резервные файлы где-либо в /etc/nginx ───"
find /etc/nginx -type f \( -name "*.bak" -o -name "*~" -o -name "*.orig" -o -name "*.backup" \) 2>/dev/null | head -20

echo ""
echo "─── 7. История shell с упоминанием bananoboom ───"
grep -i "bananoboom\|tbank/notify\|sites-available" /root/.bash_history 2>/dev/null | tail -20

echo ""
echo "─── 8. Поиск других файлов с упоминанием bananoboom ───"
grep -RIln "bananoboom\.ru" /etc /opt 2>/dev/null | grep -v "/letsencrypt/" | head -10

echo ""
echo "─── 9. Параметры SSL-сертификата (для проверки что он живой) ───"
openssl x509 -in /etc/letsencrypt/live/bananoboom.ru/cert.pem -noout -subject -issuer -dates 2>&1

echo ""
echo "================================================================"
echo " КОНЕЦ DIAG"
echo "================================================================"
