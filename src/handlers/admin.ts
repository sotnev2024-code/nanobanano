import { Keyboard } from '@maxhub/max-bot-api';
import { db_helper } from '../db';
import {
  PRICE_TREE,
  getPrice,
  getCategory,
  getModel,
  getSetting,
  getPacks,
  packLabel
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

// ─── Редактор цен: Категория → Модель → Настройка → инфо → изменить ──────────

/** Уровень 1: категории. */
export const getPricesMenuText = () =>
  `💰 Управление ценами\n\n` +
  `Шаг 1 — выберите категорию.`;

export const getPricesMenuKeyboard = () => {
  const rows = PRICE_TREE.map((c, ci) => [Keyboard.button.callback(c.label, `apc_${ci}`)]);
  rows.push([Keyboard.button.callback('💳 Пополнение (пакеты)', 'apc_packs')]);
  rows.push([Keyboard.button.callback('⬅️ Назад', 'admin_refresh_stats')]);
  return Keyboard.inlineKeyboard(rows);
};

/** Уровень 2: модели категории. */
export const getCategoryText = (ci: number) => {
  const c = getCategory(ci);
  return `${c ? c.label : 'Категория'}\n\nШаг 2 — выберите модель.`;
};

export const getCategoryKeyboard = (ci: number) => {
  const c = getCategory(ci);
  const rows = (c?.models ?? []).map((m, mi) => [
    Keyboard.button.callback(m.label, `apm_${ci}_${mi}`)
  ]);
  rows.push([Keyboard.button.callback('⬅️ К категориям', 'admin_prices')]);
  return Keyboard.inlineKeyboard(rows);
};

/** Уровень 3: настройки модели. */
export const getModelText = (ci: number, mi: number) => {
  const m = getModel(ci, mi);
  return `${m ? m.label : 'Модель'}\n\nШаг 3 — выберите настройку, чтобы посмотреть и изменить цену.`;
};

export const getModelKeyboard = (ci: number, mi: number) => {
  const m = getModel(ci, mi);
  const rows = (m?.settings ?? []).map((s, si) => [
    Keyboard.button.callback(`${s.label}: ${getPrice(s.key)} 🍌`, `aps_${ci}_${mi}_${si}`)
  ]);
  rows.push([Keyboard.button.callback('⬅️ К моделям', `apc_${ci}`)]);
  return Keyboard.inlineKeyboard(rows);
};

/** Уровень 4: информация о настройке + кнопка «Изменить цену». */
export const getSettingText = (ci: number, mi: number, si: number) => {
  const c = getCategory(ci);
  const m = getModel(ci, mi);
  const s = getSetting(ci, mi, si);
  if (!c || !m || !s) return 'Настройка не найдена.';
  return (
    `${c.label} → ${m.label}\n\n` +
    `⚙️ Настройка: ${s.label}\n` +
    `💰 Текущая цена: ${getPrice(s.key)} 🍌\n` +
    `↩️ По умолчанию: ${s.def} 🍌` +
    (s.note ? `\n\nℹ️ ${s.note}` : '')
  );
};

export const getSettingKeyboard = (ci: number, mi: number, si: number) =>
  Keyboard.inlineKeyboard([
    [Keyboard.button.callback('✏️ Изменить цену', `ape_${ci}_${mi}_${si}`)],
    [Keyboard.button.callback('⬅️ К настройкам', `apm_${ci}_${mi}`)]
  ]);

// ─── Пополнение (пакеты) ─────────────────────────────────────────────────────
export const getPacksAdminText = () =>
  `💳 Пакеты пополнения\n\nШаг 2 — выберите пакет, чтобы посмотреть и изменить.`;

export const getPacksAdminKeyboard = () => {
  const rows = getPacks().map((p, i) => [
    Keyboard.button.callback(`Пакет ${i + 1}: ${p.bananas} 🍌 — ${p.rubles}₽`, `apck_${i}`)
  ]);
  rows.push([Keyboard.button.callback('⬅️ К категориям', 'admin_prices')]);
  return Keyboard.inlineKeyboard(rows);
};

export const getPackText = (idx: number) => {
  const p = getPacks()[idx];
  if (!p) return 'Пакет не найден.';
  return (
    `💳 Пакет №${idx + 1}\n\n` +
    `🍌 Бананы: ${p.bananas}\n` +
    `₽ Сумма: ${p.rubles}\n\n` +
    `«Изменить» → введите два числа: «<бананы> <рубли>», например: 50 400`
  );
};

export const getPackKeyboard = (idx: number) =>
  Keyboard.inlineKeyboard([
    [Keyboard.button.callback('✏️ Изменить пакет', `apcke_${idx}`)],
    [Keyboard.button.callback('⬅️ К пакетам', 'apc_packs')]
  ]);
