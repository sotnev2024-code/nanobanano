/**
 * Принудительно заставляет Node соединяться по IPv4.
 *
 * Проблема: некоторые внешние сервисы (например api.kie.ai через Cloudflare)
 * публикуют и IPv4, и IPv6 (AAAA) адреса. Если у сервера нет рабочего IPv6,
 * алгоритм Happy Eyeballs (autoSelectFamily, включён по умолчанию в Node 18+)
 * зависает на «мёртвых» IPv6-адресах и отдаёт ETIMEDOUT вместо отката на IPv4.
 *
 * Этот модуль:
 *   1) ставит IPv4 первым в результатах DNS (dns.lookup) — для axios и undici/fetch;
 *   2) отключает autoSelectFamily, чтобы соединение шло строго по первому
 *      (IPv4) адресу и не ждало таймаута на IPv6.
 *
 * Важно: импортировать ПЕРВЫМ, до любых модулей, открывающих соединения.
 */
import dns from 'node:dns';
import net from 'node:net';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* старые версии Node — игнорируем */
}

try {
  const n = net as unknown as { setDefaultAutoSelectFamily?: (v: boolean) => void };
  n.setDefaultAutoSelectFamily?.(false);
} catch {
  /* метод появился не во всех версиях Node — игнорируем */
}
