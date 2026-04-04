import { Keyboard } from '@maxhub/max-bot-api';
import { User } from '../db';

export const getMotionControlText = (user: User) => {
  // AI Avatar Pro states
  if (user.motion_state === 'awaiting_avatar_photo') {
    return `👤 AI Avatar Pro

Оживи своё фото — наложи голос!

📝 Шаг 1: Загрузи фото человека
Пожалуйста, отправь изображение человека, которого нужно анимировать.`;
  }

  if (user.motion_state === 'awaiting_avatar_audio') {
    return `👤 AI Avatar Pro

Оживи своё фото — наложи голос!

📝 Шаг 2: Загрузи только аудио
Модель принимает audio_url (голос, музыка, звук) — не видеофайл.

Отправь голосовое, аудиосообщение или файл .mp3 / .wav / .m4a / .ogg и т.п.`;
  }

  if (user.motion_state === 'awaiting_avatar_prompt') {
    return `👤 AI Avatar Pro

Оживи своё фото — наложи голос!

📝 Шаг 3: Введите промпт
Напишите короткое описание сцены (или отправьте любой текст для начала генерации):`;
  }

  // InfiniTalk from-audio states
  if (user.motion_state === 'awaiting_infinitalk_photo') {
    return `🔊 InfiniTalk from-audio

Анимируй фото с помощью аудио!

📝 Шаг 1: Загрузи фото человека
Пожалуйста, отправь изображение человека, которого нужно анимировать.`;
  }

  if (user.motion_state === 'awaiting_infinitalk_audio') {
    return `🔊 InfiniTalk from-audio

Анимируй фото по аудио (модель infinitalk/from-audio).

📝 Шаг 2: Только аудио
Нужен audio_url: голосовое, аудио или файл .mp3 / .wav / .m4a … Видео не поддерживается.`;
  }

  if (user.motion_state === 'awaiting_infinitalk_prompt') {
    return `🔊 InfiniTalk from-audio

📝 Шаг 3: Промпт для видео
Текстовый промпт управляет генерацией ролика (до 5000 символов в API).

Опишите сцену, персонажа, стиль — минимум 10 символов в чате.`;
  }

  // Motion Control states
  if (user.motion_state === 'awaiting_photo') {
    return `🎬 Motion Control

Перенос движения с референсного видео на твоё фото!

📝 Шаг 1: Загрузи фото персонажа
Пожалуйста, отправь изображение человека или персонажа, которого нужно анимировать.`;
  }

  if (user.motion_state === 'awaiting_video') {
    return `🎬 Motion Control

Перенос движения с референсного видео на твоё фото!

📝 Шаг 2: Загрузи видео с движением
Пожалуйста, отправь видео, движения с которого нужно перенести на фото.`;
  }

  return `🎬 Motion Control

Перенос движения с референсного видео на твоё фото!

📝 Как это работает:
1. Загрузи фото персонажа
2. Загрузи видео с движением
3. Получи анимированное фото!

💰 Баланс: ${user.balance} 🍌

Выбери тип:`;
};

export const getMotionControlKeyboard = (user: User) => {
  if (user.motion_state === 'awaiting_avatar_prompt' || user.motion_state === 'awaiting_infinitalk_prompt') {
    return Keyboard.inlineKeyboard([
      [Keyboard.button.callback('⏭️ Пропустить промпт', 'skip_model_prompt')],
      [Keyboard.button.callback('⬅️ Назад', 'motion_control_reset')]
    ]);
  }
  if (user.motion_state !== 'idle') {
    return Keyboard.inlineKeyboard([
      [Keyboard.button.callback('⬅️ Назад', 'motion_control_reset')]
    ]);
  }

  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('⚡ Standard • Kling 2.6 MC • 720p • 15 🍌', 'set_motion_std')
    ],
    [
      Keyboard.button.callback('💎 Pro • Kling 3.0 MC • 720p • 30 🍌', 'set_motion_pro')
    ],
    [
      Keyboard.button.callback('👤 AI Avatar Pro • от 10 🍌/сек', 'set_avatar')
    ],
    [
      Keyboard.button.callback('🔊 InfiniTalk from-audio • от 10 🍌/сек', 'set_infinitalk')
    ],
    [
      Keyboard.button.callback('⬅️ Назад', 'main_menu')
    ]
  ]);
};
