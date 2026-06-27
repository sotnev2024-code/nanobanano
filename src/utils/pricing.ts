import { db_helper } from '../db';

/**
 * Единый источник цен для бота.
 *
 * Структура — дерево: Категория → Модель → Настройка (цена в 🍌).
 * Это же дерево используется и для расчётов (через getPrice по ключу),
 * и для редактора цен в админ-панели (навигация по категориям/моделям).
 *
 * Хранилище (таблица `settings`):
 *   - 'pricing_overrides' — JSON { [key]: number } с переопределениями;
 *   - 'packs'             — JSON [{ bananas, rubles }] пакеты пополнения.
 */

export interface PriceSetting {
  key: string;     // уникальный ключ цены
  label: string;   // подпись в редакторе
  def: number;     // значение по умолчанию (🍌)
  note?: string;   // пояснение на экране настройки
}

export interface PriceModel {
  id: string;
  label: string;
  settings: PriceSetting[];
}

export interface PriceCategory {
  id: string;
  label: string;
  models: PriceModel[];
}

export const PRICE_TREE: PriceCategory[] = [
  {
    id: 'video',
    label: '🎬 Видео',
    models: [
      {
        id: 'kling_3_std',
        label: '⚡ Kling 3.0 std',
        settings: [
          { key: 'video.kling_3_std.5', label: '5 секунд', def: 15 },
          { key: 'video.kling_3_std.10', label: '10 секунд', def: 30 },
          { key: 'video.kling_3_std.15', label: '15 секунд', def: 45 }
        ]
      },
      {
        id: 'kling_3_pro',
        label: '💎 Kling 3.0 pro',
        settings: [
          { key: 'video.kling_3_pro.5', label: '5 секунд', def: 15 },
          { key: 'video.kling_3_pro.10', label: '10 секунд', def: 30 },
          { key: 'video.kling_3_pro.15', label: '15 секунд', def: 45 }
        ]
      },
      {
        id: 'seedance_1.5_pro',
        label: '🌱 Seedance 1.5 pro',
        settings: [
          { key: 'video.seedance_1.5.4', label: '4 секунды', def: 14 },
          { key: 'video.seedance_1.5.8', label: '8 секунд', def: 28 },
          { key: 'video.seedance_1.5.12', label: '12 секунд', def: 42 }
        ]
      },
      {
        id: 'seedance_2',
        label: '🌿 Seedance 2.0',
        settings: [
          { key: 'video.seedance_2.4', label: '4 секунды (720p)', def: 17 },
          { key: 'video.seedance_2.8', label: '8 секунд (720p)', def: 31 },
          { key: 'video.seedance_2.12', label: '12 секунд (720p)', def: 45 },
          { key: 'video.seedance_2.1080p.4', label: 'Надбавка 1080p (4 c)', def: 10 },
          { key: 'video.seedance_2.1080p.8', label: 'Надбавка 1080p (8 c)', def: 20 },
          { key: 'video.seedance_2.1080p.12', label: 'Надбавка 1080p (12 c)', def: 30 },
          { key: 'video.seedance_2.480p_discount', label: 'Скидка за 480p', def: 5 },
          { key: 'video.seedance_2.lastframe', label: 'Надбавка за last frame', def: 5 }
        ]
      },
      {
        id: 'hailuo_2.3',
        label: '🌊 Хайлуо 2.3',
        settings: [
          { key: 'video.hailuo.6', label: '6 секунд', def: 18 },
          { key: 'video.hailuo.10', label: '10 секунд', def: 30 }
        ]
      },
      {
        id: 'veo_3.1',
        label: '👁️ Veo 3.1',
        settings: [{ key: 'video.veo', label: 'Фикс. цена (любая длительность)', def: 30 }]
      },
      {
        id: 'grok_img2video',
        label: '🤖 Grok Img→Video',
        settings: [
          { key: 'video.grok.6', label: '6 секунд', def: 18 },
          { key: 'video.grok.10', label: '10 секунд', def: 30 },
          { key: 'video.grok.15', label: '15 секунд', def: 45 },
          { key: 'video.grok.20', label: '20 секунд', def: 60 }
        ]
      }
    ]
  },
  {
    id: 'photo',
    label: '📸 Фото',
    models: [
      {
        id: 'seedream_5_lite',
        label: '🎨 Seedream 5.0 Lite',
        settings: [{ key: 'photo.seedream_5_lite.base', label: 'Базовая цена', def: 4 }]
      },
      {
        id: 'seedream_45_edit',
        label: '🌟 Seedream 4.5 Edit',
        settings: [{ key: 'photo.seedream_45_edit.base', label: 'Базовая цена', def: 4 }]
      },
      {
        id: 'nano_banana_pro',
        label: '💎 Nano Banana Pro',
        settings: [
          { key: 'photo.nano_banana_pro.base', label: 'Базовая цена', def: 5 },
          { key: 'photo.nano_banana_pro.4k', label: 'Надбавка за 4K', def: 2 }
        ]
      },
      {
        id: 'nano_banana_2',
        label: '⚡ Nano Banana 2',
        settings: [
          { key: 'photo.nano_banana_2.base', label: 'Базовая цена', def: 7 },
          { key: 'photo.nano_banana_2.4k', label: 'Надбавка за 4K', def: 3 }
        ]
      },
      {
        id: 'gpt_image_2_t2i',
        label: '🤖 GPT Image 2',
        settings: [
          { key: 'photo.gpt_image_2_t2i.base', label: 'Базовая цена', def: 5 },
          { key: 'photo.gpt_image_2_t2i.4k', label: 'Надбавка за 4K', def: 5 },
          { key: 'photo.gpt_image_2_t2i.i2i', label: 'Надбавка за референсы (i2i)', def: 1 }
        ]
      }
    ]
  },
  {
    id: 'music',
    label: '🎵 Музыка',
    models: [
      { id: 'simple', label: '🎤 Простой режим', settings: [{ key: 'music.simple', label: 'Цена', def: 8 }] },
      { id: 'custom', label: '🎼 Кастом-режим', settings: [{ key: 'music.custom', label: 'Цена', def: 12 }] },
      { id: 'instrumental', label: '🥁 Только инструментал', settings: [{ key: 'music.instrumental', label: 'Цена', def: 6 }] }
    ]
  },
  {
    id: 'motion',
    label: '🕺 Motion Control',
    models: [
      { id: 'std', label: '⚡ Standard (Kling 2.6)', settings: [{ key: 'motion.std', label: 'Цена', def: 15 }] },
      { id: 'pro', label: '💎 Pro (Kling 3.0)', settings: [{ key: 'motion.pro', label: 'Цена', def: 30 }] }
    ]
  },
  {
    id: 'avatar',
    label: '🗣 AI Avatar / InfiniTalk',
    models: [
      {
        id: 'avatar_pro',
        label: '👤 AI Avatar Pro / InfiniTalk',
        settings: [{ key: 'avatar.per_sec', label: 'Цена за секунду аудио', def: 10 }]
      }
    ]
  }
];

// Дефолты выводятся из дерева — единый источник правды.
const DEFAULTS: Record<string, number> = {};
for (const c of PRICE_TREE) for (const m of c.models) for (const s of m.settings) DEFAULTS[s.key] = s.def;

let overridesCache: Record<string, number> | null = null;

function readOverrides(): Record<string, number> {
  if (overridesCache) return overridesCache;
  let parsed: Record<string, number> = {};
  try {
    const raw = db_helper.getSetting('pricing_overrides');
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  overridesCache = parsed;
  return parsed;
}

/** Текущая цена по ключу (override → default). */
export function getPrice(key: string): number {
  const ov = readOverrides()[key];
  if (typeof ov === 'number' && Number.isFinite(ov)) return ov;
  return DEFAULTS[key] ?? 0;
}

/** Цена по ключу, либо fallback если такого ключа нет в дереве (для нестандартных значений). */
export function getPriceOr(key: string, fallback: number): number {
  if (!(key in DEFAULTS)) return fallback;
  return getPrice(key);
}

/** Установить цену (override). value < 0 запрещён. */
export function setPrice(key: string, value: number): void {
  if (!(key in DEFAULTS)) throw new Error(`Unknown price key: ${key}`);
  const ov = { ...readOverrides(), [key]: value };
  db_helper.setSetting('pricing_overrides', JSON.stringify(ov));
  overridesCache = null;
}

// ─── Навигация по дереву (для редактора в админке) ──────────────────────────
export function getCategory(ci: number): PriceCategory | undefined {
  return PRICE_TREE[ci];
}

export function getModel(ci: number, mi: number): PriceModel | undefined {
  return PRICE_TREE[ci]?.models[mi];
}

export function getSetting(ci: number, mi: number, si: number): PriceSetting | undefined {
  return PRICE_TREE[ci]?.models[mi]?.settings[si];
}

// ─── Пакеты пополнения ──────────────────────────────────────────────────────
export interface Pack {
  bananas: number;
  rubles: number;
}

export const DEFAULT_PACKS: Pack[] = [
  { bananas: 15, rubles: 150 },
  { bananas: 30, rubles: 250 },
  { bananas: 50, rubles: 400 },
  { bananas: 100, rubles: 700 },
  { bananas: 200, rubles: 1400 }
];

let packsCache: Pack[] | null = null;

export function getPacks(): Pack[] {
  if (packsCache) return packsCache;
  try {
    const raw = db_helper.getSetting('packs');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        packsCache = parsed
          .filter((p) => p && Number.isFinite(p.bananas) && Number.isFinite(p.rubles))
          .map((p) => ({ bananas: Number(p.bananas), rubles: Number(p.rubles) }));
        if (packsCache.length > 0) return packsCache;
      }
    }
  } catch {
    /* fallthrough to defaults */
  }
  packsCache = DEFAULT_PACKS.map((p) => ({ ...p }));
  return packsCache;
}

export function setPacks(packs: Pack[]): void {
  const clean = packs
    .filter((p) => Number.isFinite(p.bananas) && Number.isFinite(p.rubles) && p.bananas > 0 && p.rubles > 0)
    .map((p) => ({ bananas: Math.round(p.bananas), rubles: Math.round(p.rubles) }));
  db_helper.setSetting('packs', JSON.stringify(clean));
  packsCache = null;
}

export function setPack(index: number, bananas: number, rubles: number): void {
  const packs = getPacks().map((p) => ({ ...p }));
  if (index >= 0 && index < packs.length) {
    packs[index] = { bananas, rubles };
  } else {
    packs.push({ bananas, rubles });
  }
  setPacks(packs);
}

export function packLabel(p: Pack, index: number): string {
  const bananasEmoji = '🍌'.repeat(Math.min(5, index + 1));
  return `${bananasEmoji} ${p.bananas} 🍌 — ${p.rubles}₽`;
}
