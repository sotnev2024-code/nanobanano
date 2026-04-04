import 'dotenv/config';
import bot from './bot';
import { startTbankNotifyServer } from './tbank-notify-server';

async function main() {
  const notifyUrl = (process.env.TBANK_NOTIFICATION_URL || '').trim();
  if (notifyUrl) {
    startTbankNotifyServer();
  } else {
    console.log('T-Bank notify: пропуск (нет TBANK_NOTIFICATION_URL в .env)');
  }
  console.log('Starting bot...');
  try {
    await bot.start();
    console.log('Bot is running!');
  } catch (err) {
    console.error('Failed to start bot:', err);
    process.exit(1);
  }
}

main();
