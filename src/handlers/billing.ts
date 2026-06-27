import { Keyboard } from '@maxhub/max-bot-api';
import { getPacks, packLabel, getPrice } from '../utils/pricing';

export const getBillingMenuText = () =>
  `💳 Пополнение баланса\n\n` +
  `Выберите пакет — оплата через Т-Банк:\n\n` +
  `🍌 Бананы расходуются на генерации:\n` +
  `• Видео — от ~${getPrice('video.rate_per_sec')} 🍌/сек (зависит от модели)\n` +
  `• Seedance 1.5 (4 с) — ${getPrice('video.seedance15.4')} 🍌; 2.0 — на +${getPrice('video.seedance2_extra')} 🍌 к той же длительности\n` +
  `• AI Avatar / InfiniTalk — ${getPrice('avatar.per_sec')} 🍌 за сек аудио\n` +
  `• Фото — от ${getPrice('photo.seedream_5_lite')} 🍌`;

export const getBillingMenuKeyboard = () => {
  const rows = getPacks().map((p, i) => [
    Keyboard.button.callback(packLabel(p, i), `buy_pack_idx_${i}`)
  ]);
  rows.push([Keyboard.button.callback('⬅️ Назад', 'main_menu')]);
  return Keyboard.inlineKeyboard(rows);
};
