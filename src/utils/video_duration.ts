import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

export type VideoDurationProbeResult = {
  /** Длительность в секундах (дробная), если удалось определить */
  seconds: number | null;
  /** Откуда взяли значение */
  source: 'attachment_duration' | 'ffprobe_url' | 'unavailable';
  /** Коротко для логов / отладки */
  detail?: string;
};

function coercePositiveSeconds(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Пытается прочитать duration из сырого объекта вложения (как приходит от MAX).
 * Проверяет несколько типичных мест в JSON.
 */
export function tryDurationFromVideoAttachment(attachment: unknown): number | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const a = attachment as Record<string, unknown>;
  const candidates: unknown[] = [
    a.duration,
    (a.payload as Record<string, unknown> | undefined)?.duration,
    (a.body as Record<string, unknown> | undefined)?.duration
  ];
  for (const c of candidates) {
    const s = coercePositiveSeconds(c);
    if (s !== null) return s;
  }
  return null;
}

async function ffprobeDurationSeconds(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 }
    );
    return coercePositiveSeconds(String(stdout).trim());
  } catch (e) {
    logger.warn('video_duration', 'ffprobe failed', e);
    return null;
  }
}

const MAX_PROBE_BYTES = 80 * 1024 * 1024;

function tmpExtFromUrl(u: string): string {
  try {
    const e = path.extname(new URL(u).pathname);
    if (e && e.length >= 2 && e.length <= 6) return e;
  } catch {
    /* ignore */
  }
  return '.bin';
}

/**
 * Скачивает файл во временный файл и спрашивает ffprobe (видео или аудио).
 * Нужен FFmpeg/ffprobe в PATH.
 */
export async function tryDurationFromMediaUrl(mediaUrl: string): Promise<number | null> {
  const clean = String(mediaUrl).replace(/[`'"]/g, '').trim();
  if (!clean) return null;

  const ext = tmpExtFromUrl(clean);
  const tmp = path.join(os.tmpdir(), `probe_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  try {
    const res = await axios.get<ArrayBuffer>(clean, {
      responseType: 'arraybuffer',
      timeout: 120_000,
      maxContentLength: MAX_PROBE_BYTES,
      maxBodyLength: MAX_PROBE_BYTES
    });
    const buf = Buffer.from(res.data);
    if (buf.length === 0) return null;
    fs.writeFileSync(tmp, buf);
    return await ffprobeDurationSeconds(tmp);
  } catch (e) {
    logger.warn('video_duration', 'download or ffprobe url failed', e);
    return null;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export async function tryDurationFromVideoUrl(videoUrl: string): Promise<number | null> {
  return tryDurationFromMediaUrl(videoUrl);
}

/**
 * Тестовая проверка: можно ли узнать длительность входящего видео.
 * 1) поля вложения (как отдаёт платформа);
 * 2) иначе ffprobe по payload.url (нужен FFmpeg в системе).
 */
export async function probeIncomingVideoDuration(attachment: unknown): Promise<VideoDurationProbeResult> {
  const fromAtt = tryDurationFromVideoAttachment(attachment);
  if (fromAtt !== null) {
    return {
      seconds: fromAtt,
      source: 'attachment_duration',
      detail: 'duration из объекта вложения'
    };
  }

  if (!attachment || typeof attachment !== 'object') {
    return { seconds: null, source: 'unavailable', detail: 'нет объекта вложения' };
  }

  const url = (attachment as { payload?: { url?: string } }).payload?.url;
  if (!url || typeof url !== 'string') {
    return {
      seconds: null,
      source: 'unavailable',
      detail: 'нет duration во вложении и нет payload.url'
    };
  }

  const fromProbe = await tryDurationFromMediaUrl(url);
  if (fromProbe !== null) {
    return {
      seconds: fromProbe,
      source: 'ffprobe_url',
      detail: 'ffprobe по URL (нужен FFmpeg в PATH)'
    };
  }

  return {
    seconds: null,
    source: 'unavailable',
    detail: 'MAX не прислал duration; ffprobe не смог (нет FFmpeg или формат/лимит)'
  };
}
