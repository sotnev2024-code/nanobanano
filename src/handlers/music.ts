import { Keyboard } from '@maxhub/max-bot-api';
import { User, db_helper } from '../db';

export type MusicMode = 'simple' | 'custom' | 'instrumental';

export const MUSIC_COST: Record<MusicMode, number> = {
  simple: 8,
  custom: 12,
  instrumental: 6,
};

export const MUSIC_MODE_LABEL: Record<MusicMode, string> = {
  simple: '🎤 Простой режим',
  custom: '🎼 Кастом-режим',
  instrumental: '🥁 Только инструментал',
};

/** Прогнозируемая длительность ответа: Suno возвращает 2 трека (~30-90 сек каждый). */
export interface MusicDraft {
  prompt?: string;
  style?: string;
  title?: string;
  vocalGender?: 'm' | 'f';
}

export function parseMusicDraft(user: User): MusicDraft {
  try {
    const raw = JSON.parse(user.music_draft_json || '{}');
    return {
      prompt: typeof raw.prompt === 'string' ? raw.prompt : undefined,
      style: typeof raw.style === 'string' ? raw.style : undefined,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      vocalGender: raw.vocalGender === 'm' || raw.vocalGender === 'f' ? raw.vocalGender : undefined,
    };
  } catch {
    return {};
  }
}

export function saveMusicDraft(userId: string, draft: MusicDraft): void {
  db_helper.updateVideoSetting(userId, 'music_draft_json', JSON.stringify(draft));
}

export function clearMusicDraft(userId: string): void {
  db_helper.updateVideoSetting(userId, 'music_draft_json', '{}');
  db_helper.updateVideoSetting(userId, 'music_state', 'idle');
}

export const getMusicMenuText = (user: User): string => {
  return `🎵 Создание музыки

🍌 Ваш баланс: ${user.balance} бананов

Выбери режим генерации:

🎤 Простой — ${MUSIC_COST.simple} 🍌
   Просто опиши песню (например, «грустная песня про осень») —
   стиль и название бот выберет сам.

🎼 Кастом — ${MUSIC_COST.custom} 🍌
   Пошаговый конструктор: промпт → стиль → название → пол вокала.
   Полный контроль над треком.

🥁 Инструментал — ${MUSIC_COST.instrumental} 🍌
   Только музыка, без вокала.

ℹ️ В каждом запросе ты получаешь 2 готовых трека на выбор.
Модель: Suno V5.5 (последняя версия).`;
};

export const getMusicMenuKeyboard = (): ReturnType<typeof Keyboard.inlineKeyboard> => {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback(`${MUSIC_MODE_LABEL.simple} • ${MUSIC_COST.simple}🍌`, 'music_simple')],
    [Keyboard.button.callback(`${MUSIC_MODE_LABEL.custom} • ${MUSIC_COST.custom}🍌`, 'music_custom')],
    [Keyboard.button.callback(`${MUSIC_MODE_LABEL.instrumental} • ${MUSIC_COST.instrumental}🍌`, 'music_instrumental')],
    [Keyboard.button.callback('🏠 Главное меню', 'main_menu')],
  ]);
};

/** Текст для шага кастом-конструктора в зависимости от состояния. */
export function getMusicCustomStepPrompt(state: string, draft: MusicDraft): string {
  if (state === 'awaiting_custom_prompt') {
    return '🎼 Кастом-режим — шаг 1/4\n\n' +
      '✏️ Опиши песню (текст для генерации, до 3000 символов).\n\n' +
      'Пример: «грустная баллада о расставании, медленный темп, акустическая гитара, эмоциональный голос»';
  }
  if (state === 'awaiting_custom_style') {
    return `🎼 Кастом-режим — шаг 2/4\n\n` +
      `✅ Промпт: ${truncate(draft.prompt || '', 80)}\n\n` +
      `🎨 Укажи стиль (до 200 символов).\n\n` +
      `Примеры: «rock», «pop», «jazz», «electronic», «indie acoustic», «hip-hop»`;
  }
  if (state === 'awaiting_custom_title') {
    return `🎼 Кастом-режим — шаг 3/4\n\n` +
      `✅ Промпт: ${truncate(draft.prompt || '', 60)}\n` +
      `✅ Стиль: ${draft.style || ''}\n\n` +
      `📛 Название трека (до 80 символов).\n\n` +
      `Просто напиши название — например, «Осенний дождь»`;
  }
  if (state === 'awaiting_custom_vocal') {
    return `🎼 Кастом-режим — шаг 4/4\n\n` +
      `✅ Промпт: ${truncate(draft.prompt || '', 60)}\n` +
      `✅ Стиль: ${draft.style || ''}\n` +
      `✅ Название: ${draft.title || ''}\n\n` +
      `👤 Выбери пол вокала на кнопке ниже.`;
  }
  return '';
}

export const getMusicCustomVocalKeyboard = (): ReturnType<typeof Keyboard.inlineKeyboard> => {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('👨 Мужской', 'music_custom_vocal_m'),
      Keyboard.button.callback('👩 Женский', 'music_custom_vocal_f'),
    ],
    [Keyboard.button.callback('🤷 Авто', 'music_custom_vocal_auto')],
    [Keyboard.button.callback('❌ Отмена', 'music_cancel')],
  ]);
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
