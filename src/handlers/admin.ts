import { Keyboard } from '@maxhub/max-bot-api';
import { db_helper } from '../db';
import {
  PRICE_GROUP_LABEL,
  getPrice,
  priceFieldsByGroup,
  getPacks,
  packLabel,
  type PriceGroup
} from '../utils/pricing';

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
      Keyboard.button.callback('💰 Цены', 'admin_prices')
    ],
    [
      Keyboard.button.callback('🏠 Главное меню', 'main_menu')
    ]
  ]);
};

// ─── Редактирование цен ─────────────────────────────────────────────────────
const PRICE_GROUP_ORDER: PriceGroup[] = ['video', 'photo', 'music', 'motion', 'avatar'];

export const getPricesMenuText = () =>
  `💰 Управление ценами\n\n` +
  `Выберите категорию генераций или «Пополнение», чтобы посмотреть и изменить цены.\n` +
  `Все цены — в бананах 🍌 (кроме пакетов пополнения, где задаётся ещё и сумма в ₽).`;

export const getPricesMenuKeyboard = () => {
  const rows = PRICE_GROUP_ORDER.map((g) => [
    Keyboard.button.callback(PRICE_GROUP_LABEL[g], `admin_prices_g_${g}`)
  ]);
  rows.push([Keyboard.button.callback('💳 Пополнение (пакеты)', 'admin_prices_packs')]);
  rows.push([Keyboard.button.callback('⬅️ Назад', 'admin_refresh_stats')]);
  return Keyboard.inlineKeyboard(rows);
};

export const getPriceGroupText = (group: PriceGroup) =>
  `${PRICE_GROUP_LABEL[group]} — цены\n\n` +
  `Нажмите на пункт, чтобы изменить значение (в 🍌).\n` +
  `Текущие значения показаны на кнопках.`;

export const getPriceGroupKeyboard = (group: PriceGroup) => {
  const rows = priceFieldsByGroup(group).map((f) => [
    Keyboard.button.callback(`${f.label}: ${getPrice(f.key)} 🍌`, `apk_${f.key}`)
  ]);
  rows.push([Keyboard.button.callback('⬅️ К категориям', 'admin_prices')]);
  return Keyboard.inlineKeyboard(rows);
};

export const getPacksAdminText = () =>
  `💳 Пакеты пополнения\n\n` +
  `Нажмите на пакет, чтобы изменить его (количество 🍌 и сумму в ₽).\n` +
  `Формат при вводе: «<бананы> <рубли>», например: 50 400`;

export const getPacksAdminKeyboard = () => {
  const rows = getPacks().map((p, i) => [
    Keyboard.button.callback(`Пакет ${i + 1}: ${p.bananas} 🍌 — ${p.rubles}₽`, `apck_${i}`)
  ]);
  rows.push([Keyboard.button.callback('⬅️ К категориям', 'admin_prices')]);
  return Keyboard.inlineKeyboard(rows);
};
