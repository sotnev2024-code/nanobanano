import { Keyboard } from '@maxhub/max-bot-api';
import { User, db_helper } from '../db';
import { uploadMediaUrlForKie } from '../utils/kie_api';
import { getPrice, getPriceOr } from '../utils/pricing';

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

export type PhotoKieModelId =
  | 'seedream_5_lite'
  | 'seedream_45_edit'
  | 'nano_banana_pro'
  | 'nano_banana_2'
  | 'gpt_image_2_t2i';

/** 4K в UI: Seedream `high`, Nano `4K` в API Kie, GPT Image — `4K` (resolution-режим) */
function photo4kExtraBananas(modelId: PhotoKieModelId): number {
  if (modelId === 'seedream_5_lite' || modelId === 'seedream_45_edit') return 0;
  return getPriceOr(`photo.${modelId}.4k`, 0);
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
  'nano_banana_2',
  'gpt_image_2_t2i'
];

export const PHOTO_MODEL_CALLBACK_SUFFIX: Record<PhotoKieModelId, string> = {
  seedream_5_lite: 's5',
  seedream_45_edit: 's45',
  nano_banana_pro: 'nbp',
  nano_banana_2: 'nb2',
  gpt_image_2_t2i: 'gi2t'
};

export const PHOTO_CALLBACK_TO_MODEL: Record<string, PhotoKieModelId> = {
  s5: 'seedream_5_lite',
  s45: 'seedream_45_edit',
  nbp: 'nano_banana_pro',
  nb2: 'nano_banana_2',
  gi2t: 'gpt_image_2_t2i'
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
  },
  gpt_image_2_t2i: {
    kieModel: 'gpt-image-2-text-to-image',
    label: 'GPT Image 2',
    shortLabel: 'GPT Image 2',
    cost: 5,
    needsImageUrls: false,
    emoji: '🤖'
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

/** Базовая цена модели фото (из pricing, ключ photo.<id>.base). */
export function getPhotoModelCost(id: PhotoKieModelId): number {
  return getPrice(`photo.${id}.base`);
}

export function getPhotoOutputQuality(prefs: PhotoGenPrefs): PhotoOutputQuality {
  return prefs.output_quality === '4k' ? '4k' : '2k';
}

/**
 * Списание 🍌: база модели; 4K — без доплаты (Seedream), +2 (Nano Pro), +3 (Nano 2),
 * +5 (GPT Image 2 при non-square 4K). Для GPT Image 2 при наличии референсов — +1🍌
 * (i2i дороже t2i на стороне KIE).
 */
export function getPhotoGenerationBananaCost(
  modelId: PhotoKieModelId,
  prefs: PhotoGenPrefs,
  opts?: { hasRefs?: boolean }
): number {
  const base = getPrice(`photo.${modelId}.base`);
  let total =
    getPhotoOutputQuality(prefs) === '4k' ? base + photo4kExtraBananas(modelId) : base;
  if (modelId === 'gpt_image_2_t2i' && opts?.hasRefs) {
    total += getPrice('photo.gpt_image_2_t2i.i2i'); // GPT Image 2: i2i дороже t2i
  }
  return total;
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
  return `${mark}${m.emoji} ${m.shortLabel} • от ${getPrice(`photo.${id}.base`)} 🍌`;
}

function qualityButtonLabel(
  tier: PhotoOutputQuality,
  current: PhotoOutputQuality,
  modelId: PhotoKieModelId,
  prefs: PhotoGenPrefs,
  hasRefs: boolean
): string {
  const mark = current === tier ? '✅ ' : '';
  const bananas = getPhotoGenerationBananaCost(modelId, { ...prefs, output_quality: tier }, { hasRefs });
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
    const hasRefs = refCount > 0;
    const pay = getPhotoGenerationBananaCost(mid, p, { hasRefs });
    const qLabel = getPhotoOutputQuality(p) === '4k' ? '4K' : '2K';
    const noteS5 =
      mid === 'seedream_5_lite' && hasRefs
        ? '\n\n📎 Seedream 5.0: референсы будут использованы (Image-to-Image)'
        : '';
    const noteS45 = mid === 'seedream_45_edit' ? '\n\n📎 Seedream 4.5: нужна минимум 1 фотография.' : '';
    const noteGpt =
      mid === 'gpt_image_2_t2i'
        ? hasRefs
          ? `\n\n📎 GPT Image 2: используется Image→Image (на основе ваших референсов, +${getPrice('photo.gpt_image_2_t2i.i2i')}🍌 к стоимости)`
          : '\n\n📎 GPT Image 2: только текст. Чтобы использовать референсы — загрузите фото на шаге 1.'
        : '';

    return `🖼️ Создание фото

✨ Модель: ${meta.label}
📐 Формат: ${p.aspect_ratio}
🎯 Качество: ${qLabel} → к списанию ${pay}🍌
🍌 Баланс: ${user.balance}

Введите промпт для генерации:${noteS5}${noteS45}${noteGpt}`;
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
    const refsForCost = JSON.parse(user.photo_references || '[]');
    const hasRefs = refsForCost.length > 0;

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
      Keyboard.button.callback(qualityButtonLabel('2k', q, selected, p, hasRefs), 'photo_qual_2k'),
      Keyboard.button.callback(qualityButtonLabel('4k', q, selected, p, hasRefs), 'photo_qual_4k')
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

  // ── GPT Image 2: универсальная (text→image / image→image) ─────────────
  // Если есть референсы — используем gpt-image-2-image-to-image и шлём input_urls.
  // Если нет — gpt-image-2-text-to-image с одним только промптом.
  // 1K — auto only, 2K — все aspect (1:1 capped at 2K), 4K — non-1:1 only.
  // У нас UI: 2K/4K. При 1:1 + 4K — KIE откажет, уважим: показываем 2K.
  if (mid === 'gpt_image_2_t2i') {
    const wants4K = getPhotoOutputQuality(prefs) === '4k';
    const isSquare = aspect === '1:1';
    const gptResolution = wants4K && !isSquare ? '4K' : '2K';
    const gptAspectAllowed = ['1:1', '9:16', '16:9', '4:3', '3:4'];
    const gptAspect = gptAspectAllowed.includes(aspect) ? aspect : 'auto';

    const hasRefs = rawRefUrls.length > 0;
    if (hasRefs) {
      const kieUrls = await uploadPhotoRefsForKie(rawRefUrls, 5);
      return {
        model: 'gpt-image-2-image-to-image',
        input: {
          prompt,
          input_urls: kieUrls,
          aspect_ratio: gptAspect,
          resolution: gptResolution
        }
      };
    }

    return {
      model: 'gpt-image-2-text-to-image',
      input: {
        prompt,
        aspect_ratio: gptAspect,
        resolution: gptResolution
      }
    };
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
