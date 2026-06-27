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

async function startWebhookMode(): Promise<void> {
  if (!WEBHOOK_URL) {
    throw new Error('MAX_USE_WEBHOOK=true, но MAX_WEBHOOK_URL не задан в .env');
  }
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN не задан в .env');
  }

  // botInfo нужен Context-у для корректной работы (см. bot.js: ctx = new Context(update, api, botInfo))
  // В polling-режиме это делает bot.start(); в webhook-режиме делаем сами.
  const anyBot = bot as unknown as { botInfo?: unknown; api: { getMyInfo: () => Promise<unknown> } };
  if (!anyBot.botInfo) {
    anyBot.botInfo = await anyBot.api.getMyInfo();
  }

  // handleUpdate в библиотеке формально private, но на runtime это обычный метод —
  // используем его как точку приёма webhook-апдейтов.
  const handleUpdate = (bot as unknown as { handleUpdate: (u: unknown) => Promise<void> }).handleUpdate
    .bind(bot);

  startTbankNotifyServer({
    onMaxUpdate: (update) => handleUpdate(update),
  });

  await registerWebhook(BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET);
  const subs = await listWebhooks(BOT_TOKEN);
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
