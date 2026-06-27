import { db_helper } from '../db';

/**
 * Единый источник цен для бота.
 *
 * Цены хранятся в таблице `settings`:
 *   - 'pricing_overrides' — JSON { [priceKey]: number } с переопределениями (дефолты ниже);
 *   - 'packs'             — JSON [{ bananas, rubles }] с пакетами пополнения.
 *
 * Любой код (расчёты стоимости И подписи кнопок) читает цены только отсюда,
 * поэтому правки из админ-панели мгновенно отражаются и в цене, и в тексте.
 */

export type PriceGroup = 'video' | 'photo' | 'music' | 'motion' | 'avatar';

export interface PriceField {
  key: string;
  label: string;
  group: PriceGroup;
  def: number;
}

export const PRICE_GROUP_LABEL: Record<PriceGroup, string> = {
  video: '🎬 Видео',
  photo: '📸 Фото',
  music: '🎵 Музыка',
  motion: '🕺 Motion Control',
  avatar: '🗣 AI Avatar / InfiniTalk'
};

/** Полный список редактируемых числовых цен (гранулярно). */
export const PRICE_FIELDS: PriceField[] = [
  // ── Видео ──────────────────────────────────────────────────────────────
  { key: 'video.rate_per_sec',          label: 'Ставка 🍌/сек (Kling/Hailuo/Grok)', group: 'video', def: 3 },
  { key: 'video.veo',                   label: 'Veo 3.1 (фикс. цена)',              group: 'video', def: 30 },
  { key: 'video.seedance15.4',          label: 'Seedance 1.5 — 4 сек',              group: 'video', def: 14 },
  { key: 'video.seedance15.8',          label: 'Seedance 1.5 — 8 сек',              group: 'video', def: 28 },
  { key: 'video.seedance15.12',         label: 'Seedance 1.5 — 12 сек',             group: 'video', def: 42 },
  { key: 'video.seedance2_extra',       label: 'Seedance 2.0 — надбавка к 1.5',     group: 'video', def: 3 },
  { key: 'video.seedance2_1080p.4',     label: 'Seedance 2.0 1080p — +за 4 сек',    group: 'video', def: 10 },
  { key: 'video.seedance2_1080p.8',     label: 'Seedance 2.0 1080p — +за 8 сек',    group: 'video', def: 20 },
  { key: 'video.seedance2_1080p.12',    label: 'Seedance 2.0 1080p — +за 12 сек',   group: 'video', def: 30 },
  { key: 'video.seedance2_480p_discount', label: 'Seedance 2.0 480p — скидка',      group: 'video', def: 5 },
  { key: 'video.seedance2_lastframe',   label: 'Seedance 2.0 — last frame',         group: 'video', def: 5 },
  // ── Фото (база модели) ─────────────────────────────────────────────────
  { key: 'photo.seedream_5_lite',       label: 'Seedream 5.0 Lite',                 group: 'photo', def: 4 },
  { key: 'photo.seedream_45_edit',      label: 'Seedream 4.5 Edit',                 group: 'photo', def: 4 },
  { key: 'photo.nano_banana_pro',       label: 'Nano Banana Pro',                   group: 'photo', def: 5 },
  { key: 'photo.nano_banana_2',         label: 'Nano Banana 2',                     group: 'photo', def: 7 },
  { key: 'photo.gpt_image_2_t2i',       label: 'GPT Image 2',                       group: 'photo', def: 5 },
  // ── Фото (надбавки за 4K и i2i) ────────────────────────────────────────
  { key: 'photo.4k.nano_banana_pro',    label: '4K надбавка — Nano Banana Pro',     group: 'photo', def: 2 },
  { key: 'photo.4k.nano_banana_2',      label: '4K надбавка — Nano Banana 2',       group: 'photo', def: 3 },
  { key: 'photo.4k.gpt_image_2_t2i',    label: '4K надбавка — GPT Image 2',         group: 'photo', def: 5 },
  { key: 'photo.gpt_i2i_extra',         label: 'GPT Image 2 — надбавка i2i',        group: 'photo', def: 1 },
  // ── Музыка ─────────────────────────────────────────────────────────────
  { key: 'music.simple',                label: 'Простой режим',                     group: 'music', def: 8 },
  { key: 'music.custom',                label: 'Кастом-режим',                      group: 'music', def: 12 },
  { key: 'music.instrumental',          label: 'Только инструментал',               group: 'music', def: 6 },
  // ── Motion Control ─────────────────────────────────────────────────────
  { key: 'motion.std',                  label: 'Standard (Kling 2.6)',              group: 'motion', def: 15 },
  { key: 'motion.pro',                  label: 'Pro (Kling 3.0)',                   group: 'motion', def: 30 },
  // ── AI Avatar / InfiniTalk ─────────────────────────────────────────────
  { key: 'avatar.per_sec',              label: '🍌 за секунду аудио',               group: 'avatar', def: 10 }
];

const DEFAULTS: Record<string, number> = Object.fromEntries(PRICE_FIELDS.map((f) => [f.key, f.def]));

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

/** Установить цену (override). value < 0 запрещён. */
export function setPrice(key: string, value: number): void {
  if (!(key in DEFAULTS)) throw new Error(`Unknown price key: ${key}`);
  const ov = { ...readOverrides(), [key]: value };
  db_helper.setSetting('pricing_overrides', JSON.stringify(ov));
  overridesCache = null;
}

export function getPriceField(key: string): PriceField | undefined {
  return PRICE_FIELDS.find((f) => f.key === key);
}

export function priceFieldsByGroup(group: PriceGroup): PriceField[] {
  return PRICE_FIELDS.filter((f) => f.group === group);
}

// ─── Пакеты пополнения ────────────────────────────────────────────────────
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

/** Перезаписать весь список пакетов. */
export function setPacks(packs: Pack[]): void {
  const clean = packs
    .filter((p) => Number.isFinite(p.bananas) && Number.isFinite(p.rubles) && p.bananas > 0 && p.rubles > 0)
    .map((p) => ({ bananas: Math.round(p.bananas), rubles: Math.round(p.rubles) }));
  db_helper.setSetting('packs', JSON.stringify(clean));
  packsCache = null;
}

/** Изменить один пакет по индексу (создаёт при необходимости). */
export function setPack(index: number, bananas: number, rubles: number): void {
  const packs = getPacks().map((p) => ({ ...p }));
  if (index >= 0 && index < packs.length) {
    packs[index] = { bananas, rubles };
  } else {
    packs.push({ bananas, rubles });
  }
  setPacks(packs);
}

/** Подпись пакета для кнопки. */
export function packLabel(p: Pack, index: number): string {
  const bananasEmoji = '🍌'.repeat(Math.min(5, index + 1));
  return `${bananasEmoji} ${p.bananas} 🍌 — ${p.rubles}₽`;
}
