import { Keyboard } from '@maxhub/max-bot-api';
import { PACKS } from '../utils/tbank';

export const getBillingMenuText = () =>
  `💳 Пополнение баланса\n\n` +
  `Выберите пакет — оплата через Т-Банк:\n\n` +
  `🍌 Бананы расходуются на генерации:\n` +
  `• Видео — от ~3 🍌/сек (зависит от модели)\n` +
  `• Seedance 1.5 (4 с) — 14 🍌; 2.0 — на +3 🍌 к той же длительности\n` +
  `• AI Avatar / InfiniTalk — 10 🍌 за сек аудио\n` +
  `• Фото — от 4 🍌`;

export const getBillingMenuKeyboard = () => {
  const rows = PACKS.map(p => [
    Keyboard.button.callback(p.label, `buy_pack_${p.bananas}`)
  ]);
  rows.push([Keyboard.button.callback('⬅️ Назад', 'main_menu')]);
  return Keyboard.inlineKeyboard(rows);
};
