import './utils/net-ipv4'; // ДОЛЖНО быть первым: форсирует IPv4 до любых соединений
import 'dotenv/config';
import bot from './bot';
import { startTbankNotifyServer } from './tbank-notify-server';
import { registerWebhook, listWebhooks } from './utils/max-webhook';
import { logger } from './utils/logger';

const USE_WEBHOOK = (process.env.MAX_USE_WEBHOOK || '').toLowerCase() === 'true';
const WEBHOOK_URL = (process.env.MAX_WEBHOOK_URL || '').trim();
const WEBHOOK_SECRET = (process.env.MAX_WEBHOOK_SECRET || '').trim();
const TBANK_NOTIFY_URL = (process.env.TBANK_NOTIFICATION_URL || '').trim();
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Повторяет операцию с нарастающей паузой. attempts=0 → бесконечно.
 * Нужен, чтобы транзиентный сбой MAX API на старте (например 404 на /me во время
 * их миграции) НЕ ронял процесс: бот остаётся живым и сам восстанавливается.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 0
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (attempts && attempt >= attempts) throw err;
      const backoff = Math.min(60_000, 3000 * attempt);
      logger.warn(
        'startup',
        `${label}: попытка ${attempt} не удалась, повтор через ${backoff}ms`,
        err instanceof Error ? err.message : String(err)
      );
      await sleep(backoff);
    }
  }
}

async function startWebhookMode(): Promise<void> {
  if (!WEBHOOK_URL) {
    throw new Error('MAX_USE_WEBHOOK=true, но MAX_WEBHOOK_URL не задан в .env');
  }
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN не задан в .env');
  }

  const anyBot = bot as unknown as { botInfo?: unknown; api: { getMyInfo: () => Promise<unknown> } };

  // handleUpdate в библиотеке формально private, но на runtime это обычный метод —
  // используем его как точку приёма webhook-апдейтов.
  const handleUpdate = (bot as unknown as { handleUpdate: (u: unknown) => Promise<void> }).handleUpdate
    .bind(bot);

  // 1) HTTP-сервер поднимаем СРАЗУ — вебхук-эндпоинт всегда жив (nginx не отдаёт 502),
  //    T-Bank уведомления тоже принимаются даже пока botInfo ещё не получен.
  //    Пока botInfo не готов — апдейт пропускаем (окно старта ~<1с; MAX не шлёт во время своего сбоя).
  startTbankNotifyServer({
    onMaxUpdate: (update) => {
      if (!anyBot.botInfo) return;
      return handleUpdate(update);
    },
  });

  // 2) botInfo нужен Context-у. getMyInfo с бесконечными ретраями: сбой MAX не убивает процесс.
  if (!anyBot.botInfo) {
    anyBot.botInfo = await withRetry('getMyInfo', () => anyBot.api.getMyInfo());
  }

  // 3) Регистрация вебхука — тоже с ретраями (идемпотентно).
  await withRetry('registerWebhook', () => registerWebhook(BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET), 10);
  const subs = await listWebhooks(BOT_TOKEN).catch(() => []);
  logger.info('webhook', `Active subscriptions: ${subs.length}`, subs.map((s) => s.url).join(', '));
  console.log(`Bot is running in WEBHOOK mode at ${WEBHOOK_URL}`);
}

async function startPollingMode(): Promise<void> {
  if (TBANK_NOTIFY_URL) {
    startTbankNotifyServer();
  } else {
    console.log('T-Bank notify: пропуск (нет TBANK_NOTIFICATION_URL в .env)');
  }
  console.log('Starting bot (polling)...');
  await bot.start();
  console.log('Bot is running!');
}

async function main() {
  try {
    if (USE_WEBHOOK) {
      await startWebhookMode();
    } else {
      await startPollingMode();
    }
  } catch (err) {
    console.error('Failed to start bot:', err);
    process.exit(1);
  }
}

main();
