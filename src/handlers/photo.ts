import { Keyboard } from '@maxhub/max-bot-api';
import { User, db_helper } from '../db';
import { uploadMediaUrlForKie } from '../utils/kie_api';

const NANO_OUTPUT_FORMAT_FIXED = 'jpg' as const;

/** mid карточки «Создание фото» из callback; при входящем фото ctx.messageId — сообщение пользователя */
export function persistPhotoMenuMessageId(ctx: { messageId?: string; message?: unknown }, userId: string) {
  const menuMid =
    ctx.messageId ??
    (ctx.message && typeof ctx.message === 'object' && ctx.message !== null && 'body' in ctx.message
      ? (ctx.message as { body: { mid?: string } }).body?.mid
      : undefined);
  if (menuMid !== undefined && menuMid !== null && menuMid !== '') {
    db_helper.updateVideoSetting(userId, 'photo_menu_message_id', String(menuMid));
  }
}

export type PhotoKieModelId = 'seedream_5_lite' | 'seedream_45_edit' | 'nano_banana_pro' | 'nano_banana_2';

/** 4K в UI: Seedream `high`, Nano `4K` в API Kie */
function photo4kExtraBananas(modelId: PhotoKieModelId): number {
  if (modelId === 'seedream_5_lite' || modelId === 'seedream_45_edit') return 0;
  if (modelId === 'nano_banana_2') return 3;
  return 2;
}

export type PhotoOutputQuality = '2k' | '4k';

/** Соотношение сторон + выход 2K/4K (где модель поддерживает оба) */
export type PhotoGenPrefs = {
  aspect_ratio: string;
  output_quality: PhotoOutputQuality;
};

export const PHOTO_MODEL_ORDER: PhotoKieModelId[] = [
  'seedream_5_lite',
  'seedream_45_edit',
  'nano_banana_pro',
  'nano_banana_2'
];

export const PHOTO_MODEL_CALLBACK_SUFFIX: Record<PhotoKieModelId, string> = {
  seedream_5_lite: 's5',
  seedream_45_edit: 's45',
  nano_banana_pro: 'nbp',
  nano_banana_2: 'nb2'
};

export const PHOTO_CALLBACK_TO_MODEL: Record<string, PhotoKieModelId> = {
  s5: 'seedream_5_lite',
  s45: 'seedream_45_edit',
  nbp: 'nano_banana_pro',
  nb2: 'nano_banana_2'
};

export const PHOTO_MODEL_META: Record<
  PhotoKieModelId,
  {
    kieModel: string;
    label: string;
    shortLabel: string;
    cost: number;
    needsImageUrls: boolean;
    emoji: string;
  }
> = {
  seedream_5_lite: {
    kieModel: 'seedream/5-lite-text-to-image',
    label: 'Seedream 5.0 Lite',
    shortLabel: 'Seedream 5.0',
    cost: 4,
    needsImageUrls: false,
    emoji: '🎨'
  },
  seedream_45_edit: {
    kieModel: 'seedream/4.5-edit',
    label: 'Seedream 4.5 Edit',
    shortLabel: 'Seedream 4.5',
    cost: 4,
    needsImageUrls: true,
    emoji: '🌟'
  },
  nano_banana_pro: {
    kieModel: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    shortLabel: 'Banana Pro',
    cost: 5,
    needsImageUrls: false,
    emoji: '💎'
  },
  nano_banana_2: {
    kieModel: 'nano-banana-2',
    label: 'Nano Banana 2',
    shortLabel: 'Banana 2',
    cost: 7,
    needsImageUrls: false,
    emoji: '⚡'
  }
};

export function defaultPhotoGenPrefs(): PhotoGenPrefs {
  return { aspect_ratio: '1:1', output_quality: '4k' };
}

export function parsePhotoGenPrefs(user: User): PhotoGenPrefs {
  try {
    const raw = JSON.parse(user.photo_gen_json || '{}');
    return { ...defaultPhotoGenPrefs(), ...raw };
  } catch {
    return defaultPhotoGenPrefs();
  }
}

export function savePhotoGenPrefs(userId: string, prefs: PhotoGenPrefs) {
  db_helper.updateVideoSetting(userId, 'photo_gen_json', JSON.stringify(prefs));
}

/** Старт экрана «модель + формат» после референсов */
export function primePhotoConfigureStep(userId: string) {
  db_helper.updateVideoSetting(userId, 'photo_kie_model', 'seedream_5_lite');
  savePhotoGenPrefs(userId, defaultPhotoGenPrefs());
}

export function getPhotoModelCost(id: PhotoKieModelId): number {
  return PHOTO_MODEL_META[id].cost;
}

export function getPhotoOutputQuality(prefs: PhotoGenPrefs): PhotoOutputQuality {
  return prefs.output_quality === '4k' ? '4k' : '2k';
}

/** Списание 🍌: база модели; 4K — без доплаты (Seedream), +2 (Nano Pro), +3 (Nano 2). */
export function getPhotoGenerationBananaCost(modelId: PhotoKieModelId, prefs: PhotoGenPrefs): number {
  const base = PHOTO_MODEL_META[modelId].cost;
  return getPhotoOutputQuality(prefs) === '4k' ? base + photo4kExtraBananas(modelId) : base;
}

function aspectKeyFromRatio(ratio: string): string {
  const m: Record<string, string> = {
    '1:1': 'photo_ar_1_1',
    '16:9': 'photo_ar_16_9',
    '9:16': 'photo_ar_9_16',
    '4:3': 'photo_ar_4_3',
    '3:2': 'photo_ar_3_2'
  };
  return m[ratio] || 'photo_ar_1_1';
}

function modelButtonLabel(id: PhotoKieModelId, selected: PhotoKieModelId | null): string {
  const m = PHOTO_MODEL_META[id];
  const mark = selected === id ? '✅ ' : '';
  return `${mark}${m.emoji} ${m.shortLabel} • от ${m.cost} 🍌`;
}

function qualityButtonLabel(
  tier: PhotoOutputQuality,
  current: PhotoOutputQuality,
  modelId: PhotoKieModelId,
  prefs: PhotoGenPrefs
): string {
  const mark = current === tier ? '✅ ' : '';
  const bananas = getPhotoGenerationBananaCost(modelId, { ...prefs, output_quality: tier });
  const label = tier === '2k' ? '2K' : '4K';
  return `${mark}${label} (${bananas}🍌)`;
}

function aspectButtonLabel(ratio: string, current: string): string {
  const mark = current === ratio ? '✅ ' : '';
  return `${mark}${ratio}`;
}

export const getPhotoMenuText = (user: User) => {
  const refs = JSON.parse(user.photo_references || '[]');
  const refCount = refs.length;

  if (user.photo_state === 'awaiting_refs') {
    return `🖼️ Создание фото

🍌 Ваш баланс: ${user.balance} бананов

Шаг 1: Загрузка референсов (опционально)

Загрузите изображения для:
• Точного сходства с объектом
• Сохранения стиля
• Персонажей (до 14 фото)

После загрузки нажмите «Продолжить» или «Пропустить»

Загружено: ${refCount}/14`;
  }

  if (user.photo_state === 'awaiting_photo_model') {
    const mid = (user.photo_kie_model as PhotoKieModelId | null) || 'seedream_5_lite';
    const meta = PHOTO_MODEL_META[mid] ? PHOTO_MODEL_META[mid] : PHOTO_MODEL_META.seedream_5_lite;
    const p = parsePhotoGenPrefs(user);
    const pay = getPhotoGenerationBananaCost(mid, p);
    const qLabel = getPhotoOutputQuality(p) === '4k' ? '4K' : '2K';
    const noteS5 =
      mid === 'seedream_5_lite' && refCount > 0
        ? '\n\n📎 Seedream 5.0: референсы будут использованы (Image-to-Image)'
        : '';
    const noteS45 = mid === 'seedream_45_edit' ? '\n\n📎 Seedream 4.5: нужна минимум 1 фотография.' : '';

    return `🖼️ Создание фото

✨ Модель: ${meta.label}
📐 Формат: ${p.aspect_ratio}
🎯 Качество: ${qLabel} → к списанию ${pay}🍌
🍌 Баланс: ${user.balance}

Введите промпт для генерации:${noteS5}${noteS45}`;
  }

  return `🖼️ Создание фото

Выберите действие для начала работы.`;
};

export const getPhotoMenuKeyboard = (user: User) => {
  if (user.photo_state === 'awaiting_refs') {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('⏭️ Пропустить', 'photo_skip_refs'),
        Keyboard.button.callback('✅ Продолжить', 'photo_continue_to_prompt')
      ],
      [Keyboard.button.callback('⬅️ Назад', 'main_menu')]
    ]);
  }

  if (user.photo_state === 'awaiting_photo_model') {
    const selected = (user.photo_kie_model as PhotoKieModelId | null) || 'seedream_5_lite';
    const p = parsePhotoGenPrefs(user);

    const modelRows: ReturnType<typeof Keyboard.button.callback>[][] = [];
    for (const id of PHOTO_MODEL_ORDER) {
      const suf = PHOTO_MODEL_CALLBACK_SUFFIX[id];
      modelRows.push([Keyboard.button.callback(modelButtonLabel(id, selected), `photo_pick_${suf}`)]);
    }

    const arRow1 = ['1:1', '16:9', '9:16'].map((r) =>
      Keyboard.button.callback(aspectButtonLabel(r, p.aspect_ratio), aspectKeyFromRatio(r))
    );
    const arRow2 = ['4:3', '3:2'].map((r) =>
      Keyboard.button.callback(aspectButtonLabel(r, p.aspect_ratio), aspectKeyFromRatio(r))
    );

    const q = getPhotoOutputQuality(p);
    const qualRow = [
      Keyboard.button.callback(qualityButtonLabel('2k', q, selected, p), 'photo_qual_2k'),
      Keyboard.button.callback(qualityButtonLabel('4k', q, selected, p), 'photo_qual_4k')
    ];

    return Keyboard.inlineKeyboard([
      ...modelRows,
      arRow1,
      arRow2,
      qualRow,
      [Keyboard.button.callback('⬅️ К референсам', 'photo_back_to_refs')],
      [Keyboard.button.callback('🏠 Главное меню', 'main_menu')]
    ]);
  }

  return Keyboard.inlineKeyboard([[Keyboard.button.callback('🏠 Главное меню', 'main_menu')]]);
};

const AR_MAP: Record<string, string> = {
  photo_ar_1_1: '1:1',
  photo_ar_16_9: '16:9',
  photo_ar_9_16: '9:16',
  photo_ar_4_3: '4:3',
  photo_ar_3_2: '3:2'
};

export const PHOTO_AR_CALLBACK_PAYLOADS = Object.keys(AR_MAP);

export function photoCallbackToAspectRatio(payload: string): string | undefined {
  return AR_MAP[payload];
}

export async function uploadPhotoRefsForKie(
  refUrls: string[],
  maxCount: number
): Promise<string[]> {
  const out: string[] = [];
  const slice = refUrls.slice(0, maxCount);
  let i = 0;
  for (const url of slice) {
    i++;
    const clean = String(url).replace(/[`'"]/g, '').trim();
    if (!clean) continue;
    const ext = clean.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const uploaded = await uploadMediaUrlForKie(clean, `photo_ref_${Date.now()}_${i}.${ext}`);
    out.push(uploaded);
  }
  return out;
}

export async function buildPhotoCreateTaskParams(
  user: User,
  prompt: string,
  rawRefUrls: string[]
): Promise<{ model: string; input: Record<string, unknown> }> {
  const mid = user.photo_kie_model as PhotoKieModelId;
  const meta = PHOTO_MODEL_META[mid];
  const prefs = parsePhotoGenPrefs(user);
  const aspect = prefs.aspect_ratio;
  const seedreamQuality = getPhotoOutputQuality(prefs) === '4k' ? 'high' : 'basic';
  const nanoRes = getPhotoOutputQuality(prefs) === '4k' ? '4K' : '2K';

  if (mid === 'seedream_5_lite') {
    if (rawRefUrls.length > 0) {
      const kieUrls = await uploadPhotoRefsForKie(rawRefUrls, 14);
      return {
        model: 'seedream/5-lite-image-to-image',
        input: {
          prompt,
          image_urls: kieUrls,
          aspect_ratio: aspect,
          quality: seedreamQuality,
          nsfw_checker: true
        }
      };
    }
    return {
      model: meta.kieModel,
      input: {
        prompt,
        aspect_ratio: aspect,
        quality: seedreamQuality,
        nsfw_checker: true
      }
    };
  }

  if (mid === 'seedream_45_edit') {
    const kieUrls = await uploadPhotoRefsForKie(rawRefUrls, 14);
    if (kieUrls.length === 0) {
      throw new Error('NO_REFS_FOR_SEEDREAM_EDIT');
    }
    return {
      model: meta.kieModel,
      input: {
        prompt,
        image_urls: kieUrls,
        aspect_ratio: aspect,
        quality: seedreamQuality,
        nsfw_checker: true
      }
    };
  }

  if (mid === 'nano_banana_pro') {
    const kieUrls = rawRefUrls.length ? await uploadPhotoRefsForKie(rawRefUrls, 8) : [];
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: aspect,
      resolution: nanoRes,
      output_format: NANO_OUTPUT_FORMAT_FIXED
    };
    if (kieUrls.length) input.image_input = kieUrls;
    return { model: meta.kieModel, input };
  }

  const kieUrls = rawRefUrls.length ? await uploadPhotoRefsForKie(rawRefUrls, 14) : [];
  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspect,
    resolution: nanoRes,
    output_format: NANO_OUTPUT_FORMAT_FIXED
  };
  if (kieUrls.length) input.image_input = kieUrls;
  return { model: meta.kieModel, input };
}
