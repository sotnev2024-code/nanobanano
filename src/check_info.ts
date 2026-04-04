import { Bot } from '@maxhub/max-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.BOT_TOKEN;

async function checkBotInfo() {
  if (!token) {
    console.error('Ошибка: BOT_TOKEN не найден в .env файле');
    return;
  }

  const bot = new Bot(token);
  
  try {
    console.log('Запрос информации о боте...');
    const botInfo = await bot.api.getMyInfo();
    console.log('\n=== Информация о боте ===');
    console.log(`Название: ${botInfo.name}`);
    console.log(`Юзернейм: @${botInfo.username}`);
    console.log(`ID: ${botInfo.user_id}`);
    console.log(`Это бот: ${botInfo.is_bot}`);
    console.log('==========================\n');
  } catch (error) {
    console.error('Ошибка при получении информации:', error);
  }
}

checkBotInfo();
