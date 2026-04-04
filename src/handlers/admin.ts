import { Keyboard } from '@maxhub/max-bot-api';
import { db_helper } from '../db';

export const getAdminPanelText = () => {
  const stats = db_helper.getStats();
  return `👑 Админ-панель

📊 Статистика:
👥 Всего пользователей: ${stats.totalUsers}
🔄 Всего генераций: ${stats.totalGenerations}
✅ Успешных: ${stats.successGenerations}
❌ Ошибок: ${stats.failGenerations}

Выберите действие:`;
};

export const getAdminPanelKeyboard = () => {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('📊 Обновить статистику', 'admin_refresh_stats'),
      Keyboard.button.callback('🍌 Начислить бананы', 'admin_add_bananas_start')
    ],
    [
      Keyboard.button.callback('📢 Рассылка', 'admin_broadcast_start')
    ],
    [
      Keyboard.button.callback('📋 Таблица пользователей', 'admin_users_excel')
    ],
    [
      Keyboard.button.callback('📝 Промпты и модерация', 'admin_prompts_excel')
    ],
    [
      Keyboard.button.callback('🏠 Главное меню', 'main_menu')
    ]
  ]);
};
