import { Keyboard } from '@maxhub/max-bot-api';
import { User, db_helper } from '../db';

/** Доп. настройки видео (Seedance 2.0: в UI — только аудио; 720p / без кадра / web-поиск вкл — фикс в API). */
export type VideoGenPrefs = {
  seedance2_generate_audio: boolean;
};

export const DEFAULT_VIDEO_GEN_PREFS: VideoGenPrefs = {
  seedance2_generate_audio: true
};

export function parseVideoGenPrefs(user: User): VideoGenPrefs {
  try {
    const raw = JSON.parse(user.video_gen_json || '{}');
    const audio = raw.seedance2_generate_audio;
    return {
      seedance2_generate_audio:
        typeof audio === 'boolean' ? audio : DEFAULT_VIDEO_GEN_PREFS.seedance2_generate_audio
    };
  } catch {
    return { ...DEFAULT_VIDEO_GEN_PREFS };
  }
}

export function saveVideoGenPrefs(userId: string, prefs: VideoGenPrefs): void {
  db_helper.updateVideoSetting(userId, 'video_gen_json', JSON.stringify(prefs));
}

export const modelMap: Record<string, string> = {
    'kling_3_std': 'Kling 3.0 std',
    'kling_3_pro': 'Kling 3.0 pro',
    'kling_2.6_motion': 'Kling 2.6 motion control',
    'kling_3_motion': 'Kling 3.0 motion control',
    'seedance_1.5_pro': 'Seedance 1.5 pro',
    'seedance_2': 'Seedance 2.0',
    'hailuo_2.3': 'Хайлуо 2.3',
    'veo_3.1': 'Veo 3.1',
    'grok_img2video': 'Grok Img→Video',
    'ai_avatar_pro': 'AI Avatar Pro',
    'from_audio': 'infinitalk/from-audio'
  };

// По умолчанию 3 🍌/сек. Veo — фикс 30. Seedance 1.5 pro: 4/8/12 с → 14/28/42; 2.0 — +3 🍌 к каждой ступени (17/31/45).
const SEEDANCE_15_BANANAS: Record<number, number> = { 4: 14, 8: 28, 12: 42 };
const SEEDANCE_2_EXTRA = 3;

export const getVideoCost = (modelId: string, durationStr: string): number => {
  if (modelId.includes('veo')) return 30;
  const m = durationStr.match(/(\d+)/);
  const sec = m ? parseInt(m[1], 10) : 5;

  if (modelId === 'seedance_2') {
    const base = SEEDANCE_15_BANANAS[sec];
    return base !== undefined ? base + SEEDANCE_2_EXTRA : sec * 3 + SEEDANCE_2_EXTRA;
  }
  if (modelId.includes('seedance')) {
    return SEEDANCE_15_BANANAS[sec] ?? sec * 3;
  }

  return sec * 3;
};

export const getVideoMenuText = (user: User) => {
  const modeMap: Record<string, string> = {
    'text_to_video': 'Текст ➔ Видео',
    'photo_to_video': 'Фото + Текст ➔ Видео',
    'video_to_video': 'Видео + Текст ➔ Видео'
  };

  const caps = getModelCapabilities(user.video_model);
  const cost = getVideoCost(user.video_model, user.video_duration);

  let mediaStatus = '';
  if (user.video_mode === 'photo_to_video' || user.video_model.includes('motion') || user.video_model.includes('hailuo') || user.video_model.includes('grok')) {
    mediaStatus = `\n🖼️ Фото: ${user.stored_image_url ? '✅ Загружено' : '❌ Ожидается'}`;
  }
  if (user.video_mode === 'video_to_video' || user.video_model.includes('motion')) {
    mediaStatus += `\n🎬 Видео: ${user.stored_video_url ? '✅ Загружено' : '❌ Ожидается'}`;
  }

  const grokModeLabel: Record<string, string> = { fun: '🎉 Fun', normal: '⚡ Normal' };
  const v2 = user.video_model === 'seedance_2' ? parseVideoGenPrefs(user) : null;
  const settingsText = [
    caps.modes ? `📝 Тип: ${modeMap[user.video_mode] || user.video_mode}` : null,
    `🤖 Модель: ${modelMap[user.video_model] || user.video_model}`,
    user.video_model.includes('grok') ? `🎭 Стиль: ${grokModeLabel[user.grok_mode] || user.grok_mode}` : null,
    caps.duration ? `⏱ Длительность: ${user.video_duration}` : null,
    caps.ratio ? `📐 Формат: ${user.video_ratio}` : null,
    v2
      ? `🎵 Аудио в ролике: ${v2.seedance2_generate_audio ? 'да' : 'нет'}\n🌐 Поиск в сети: да`
      : null,
    `💰 Стоимость: ${cost} 🍌`,
  ].filter(Boolean).join('\n');

  return `🎬 Создание видео

⚙️ Текущие настройки:
${settingsText}${mediaStatus}

Введите промпт для генерации:

Опишите видео, которое хотите создать:
• Что происходит в сцене
• Движение камеры
• Стиль и атмосфера`;
};

export const getModelCapabilities = (model: string) => {
  return {
    ratio: model.includes('seedance') || model.includes('kling_3') || model.includes('veo_3.1') || model.includes('grok'),
    duration: model.includes('seedance') || model.includes('hailuo') || model.includes('kling_3') || model.includes('grok'),
    modes: !model.includes('avatar') && !model.includes('audio') && !model.includes('motion') && !model.includes('hailuo') && !model.includes('grok')
  };
};

export const getVideoMenuKeyboard = (user: User) => {
  const check = (current: string, target: string) => current === target ? '✅ ' : '';
  const caps = getModelCapabilities(user.video_model);
  const rows: any[][] = [];

  // Row 1: Modes (only if supported)
  if (caps.modes) {
    rows.push([
      Keyboard.button.callback(`${check(user.video_mode, 'text_to_video')}📝 Текст → В...`, 'set_mode_text_to_video'),
      Keyboard.button.callback(`${check(user.video_mode, 'photo_to_video')}🖼️ Фото + Текст ...`, 'set_mode_photo_to_video'),
      Keyboard.button.callback(`${check(user.video_mode, 'video_to_video')}🎬 Видео + Текс...`, 'set_mode_video_to_video')
    ]);
  }

  // Models list (min price shown)
  const models = [
    { id: 'kling_3_std',      label: '⚡ Kling 3.0 std • от 15 🍌' },
    { id: 'kling_3_pro',      label: '💎 Kling 3.0 pro • от 15 🍌' },
    { id: 'seedance_1.5_pro', label: '🌱 Seedance 1.5 pro • от 14 🍌' },
    { id: 'seedance_2',       label: '🌿 Seedance 2.0 • от 17 🍌' },
    { id: 'hailuo_2.3',       label: '🌊 Хайлуо 2.3 • от 18 🍌' },
    { id: 'veo_3.1',          label: '👁️ Veo 3.1 • 30 🍌' },
    { id: 'grok_img2video',   label: '🤖 Grok Img→Video • от 18 🍌' }
  ];

  models.forEach(m => {
    rows.push([Keyboard.button.callback(`${check(user.video_model, m.id)}${m.label}`, `set_model_${m.id}`)]);
  });

  // Aspect Ratios (only if supported)
  if (caps.ratio) {
    if (user.video_model.includes('grok')) {
      rows.push([
        Keyboard.button.callback(`${check(user.video_ratio, '16:9')}16:9`, 'set_ratio_16:9'),
        Keyboard.button.callback(`${check(user.video_ratio, '9:16')}9:16`, 'set_ratio_9:16'),
        Keyboard.button.callback(`${check(user.video_ratio, '1:1')}1:1`, 'set_ratio_1:1'),
        Keyboard.button.callback(`${check(user.video_ratio, '2:3')}2:3`, 'set_ratio_2:3'),
        Keyboard.button.callback(`${check(user.video_ratio, '3:2')}3:2`, 'set_ratio_3:2')
      ]);
    } else if (user.video_model.includes('kling_3')) {
      rows.push([
        Keyboard.button.callback(`${check(user.video_ratio, '16:9')}16:9`, 'set_ratio_16:9'),
        Keyboard.button.callback(`${check(user.video_ratio, '9:16')}9:16`, 'set_ratio_9:16'),
        Keyboard.button.callback(`${check(user.video_ratio, '1:1')}1:1`, 'set_ratio_1:1')
      ]);
    } else if (user.video_model.includes('seedance')) {
      const ratioRow = [
        Keyboard.button.callback(`${check(user.video_ratio, '1:1')}1:1`, 'set_ratio_1:1'),
        Keyboard.button.callback(`${check(user.video_ratio, '16:9')}16:9`, 'set_ratio_16:9'),
        Keyboard.button.callback(`${check(user.video_ratio, '9:16')}9:16`, 'set_ratio_9:16'),
        Keyboard.button.callback(`${check(user.video_ratio, '4:3')}4:3`, 'set_ratio_4:3'),
        Keyboard.button.callback(`${check(user.video_ratio, '3:4')}3:4`, 'set_ratio_3:4'),
        Keyboard.button.callback(`${check(user.video_ratio, '21:9')}21:9`, 'set_ratio_21:9')
      ];
      if (user.video_model === 'seedance_2') {
        ratioRow.push(
          Keyboard.button.callback(`${check(user.video_ratio, 'adaptive')}Адаптив`, 'set_ratio_adaptive')
        );
      }
      rows.push(ratioRow);
    } else if (user.video_model.includes('veo_3.1')) {
      rows.push([
        Keyboard.button.callback(`${check(user.video_ratio, '16:9')}16:9`, 'set_ratio_16:9'),
        Keyboard.button.callback(`${check(user.video_ratio, '9:16')}9:16`, 'set_ratio_9:16'),
        Keyboard.button.callback(`${check(user.video_ratio, 'Auto')}Auto`, 'set_ratio_Auto')
      ]);
    }
  }

  // Grok style (fun / normal)
  if (user.video_model.includes('grok')) {
    const checkGrok = (v: string) => user.grok_mode === v ? '✅ ' : '';
    rows.push([
      Keyboard.button.callback(`${checkGrok('normal')}⚡ Normal`, 'set_grok_mode_normal'),
      Keyboard.button.callback(`${checkGrok('fun')}🎉 Fun`, 'set_grok_mode_fun')
    ]);
  }

  // Durations with price (only if supported)
  if (caps.duration) {
    if (user.video_model.includes('grok')) {
      rows.push([
        Keyboard.button.callback(`${check(user.video_duration, '6 сек')}6 сек • 18 🍌`, 'set_duration_6 сек'),
        Keyboard.button.callback(`${check(user.video_duration, '10 сек')}10 сек • 30 🍌`, 'set_duration_10 сек'),
        Keyboard.button.callback(`${check(user.video_duration, '15 сек')}15 сек • 45 🍌`, 'set_duration_15 сек'),
        Keyboard.button.callback(`${check(user.video_duration, '20 сек')}20 сек • 60 🍌`, 'set_duration_20 сек')
      ]);
    } else if (user.video_model.includes('hailuo')) {
      rows.push([
        Keyboard.button.callback(`${check(user.video_duration, '6 сек')}6 сек • 18 🍌`, 'set_duration_6 сек'),
        Keyboard.button.callback(`${check(user.video_duration, '10 сек')}10 сек • 30 🍌`, 'set_duration_10 сек')
      ]);
    } else if (user.video_model.includes('seedance')) {
      const s2 = user.video_model === 'seedance_2';
      rows.push([
        Keyboard.button.callback(
          `${check(user.video_duration, '4 сек')}4 сек • ${s2 ? 17 : 14} 🍌`,
          'set_duration_4 сек'
        ),
        Keyboard.button.callback(
          `${check(user.video_duration, '8 сек')}8 сек • ${s2 ? 31 : 28} 🍌`,
          'set_duration_8 сек'
        ),
        Keyboard.button.callback(
          `${check(user.video_duration, '12 сек')}12 сек • ${s2 ? 45 : 42} 🍌`,
          'set_duration_12 сек'
        )
      ]);
      if (user.video_model === 'seedance_2') {
        const v = parseVideoGenPrefs(user);
        const mk = (cond: boolean) => (cond ? '✅ ' : '');
        rows.push([
          Keyboard.button.callback(`${mk(v.seedance2_generate_audio)}🎵 С аудио`, 'set_seed2_audio_1'),
          Keyboard.button.callback(`${mk(!v.seedance2_generate_audio)}🔇 Без аудио`, 'set_seed2_audio_0')
        ]);
      }
    } else if (user.video_model.includes('kling_3')) {
      rows.push([
        Keyboard.button.callback(`${check(user.video_duration, '5 сек')}5 сек • 15 🍌`, 'set_duration_5 сек'),
        Keyboard.button.callback(`${check(user.video_duration, '10 сек')}10 сек • 30 🍌`, 'set_duration_10 сек'),
        Keyboard.button.callback(`${check(user.video_duration, '15 сек')}15 сек • 45 🍌`, 'set_duration_15 сек')
      ]);
    }
  }

  rows.push([Keyboard.button.callback('🏠 Главное меню', 'main_menu')]);

  return Keyboard.inlineKeyboard(rows);
};
