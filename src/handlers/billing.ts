import { Keyboard } from '@maxhub/max-bot-api';
import { getPacks, packLabel, getPrice } from '../utils/pricing';

export const getBillingMenuText = () =>
  `💳 Пополнение баланса\n\n` +
  `Выберите пакет — оплата через Т-Банк:\n\n` +
  `🍌 Бананы расходуются на генерации:\n` +
  `• Видео — от ${getPrice('video.seedance_1.5.4')} 🍌 (зависит от модели и длительности)\n` +
  `• Seedance 2.0 (4 с) — ${getPrice('video.seedance_2.4')} 🍌\n` +
  `• AI Avatar / InfiniTalk — ${getPrice('avatar.per_sec')} 🍌 за сек аудио\n` +
  `• Фото — от ${getPrice('photo.seedream_5_lite.2k')} 🍌`;

export const getBillingMenuKeyboard = () => {
  const rows = getPacks().map((p, i) => [
    Keyboard.button.callback(packLabel(p, i), `buy_pack_idx_${i}`)
  ]);
  rows.push([Keyboard.button.callback('⬅️ Назад', 'main_menu')]);
  return Keyboard.inlineKeyboard(rows);
};
