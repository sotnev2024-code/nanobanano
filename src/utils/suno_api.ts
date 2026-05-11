import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

const API_KEY = process.env.api_key;
/** Эндпоинты Suno на стороне KIE отличаются от /jobs/createTask (там Kling/Seedance). */
const SUNO_GENERATE_URL = 'https://api.kie.ai/api/v1/generate';
const SUNO_RECORD_INFO_URL = 'https://api.kie.ai/api/v1/generate/record-info';

/** Параметры запроса в Suno (V5_5 only — клиент попросил без выбора моделей). */
export interface SunoCreateTaskParams {
  prompt: string;            // 500 chars в простом режиме / 3000-5000 в кастоме
  customMode: boolean;       // true → нужны style+title
  instrumental: boolean;     // true → без вокала
  model: 'V5_5';
  callBackUrl?: string;
  /** Только для customMode=true */
  style?: string;
  title?: string;
  /** Опционально для тонкой настройки */
  vocalGender?: 'm' | 'f';
  styleWeight?: number;
  weirdnessConstraint?: number;
  audioWeight?: number;
  negativeTags?: string;
}

export interface SunoTaskResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
  };
}

export interface SunoTrack {
  id?: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;          // обложка
  prompt?: string;            // текст песни (lyrics)
  title?: string;
  tags?: string;
  duration?: number;          // секунды
}

export interface SunoRecordInfoResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    /** Статус в Suno-style: PENDING / TEXT_SUCCESS / FIRST_SUCCESS / SUCCESS / SENSITIVE_WORD_ERROR / CREATE_TASK_FAILED / GENERATE_AUDIO_FAILED / etc. */
    status?: string;
    type?: string;
    callbackType?: string;
    response?: {
      taskId?: string;
      sunoData?: SunoTrack[];
    };
    errorCode?: string | number | null;
    errorMessage?: string | null;
  };
}

export const suno_api = {
  createTask: async (params: SunoCreateTaskParams): Promise<SunoTaskResponse> => {
    if (!API_KEY) throw new Error('api_key is not set');
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      customMode: params.customMode,
      instrumental: params.instrumental,
      model: params.model,
      callBackUrl:
        params.callBackUrl ||
        process.env.KIE_CALLBACK_URL ||
        'https://example.com/kie-callback',
    };
    if (params.style) body.style = params.style;
    if (params.title) body.title = params.title;
    if (params.vocalGender) body.vocalGender = params.vocalGender;
    if (params.styleWeight !== undefined) body.styleWeight = params.styleWeight;
    if (params.weirdnessConstraint !== undefined) body.weirdnessConstraint = params.weirdnessConstraint;
    if (params.audioWeight !== undefined) body.audioWeight = params.audioWeight;
    if (params.negativeTags) body.negativeTags = params.negativeTags;

    const res = await axios.post<SunoTaskResponse>(SUNO_GENERATE_URL, body, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    return res.data;
  },

  getRecordInfo: async (taskId: string): Promise<SunoRecordInfoResponse> => {
    if (!API_KEY) throw new Error('api_key is not set');
    try {
      const res = await axios.get<SunoRecordInfoResponse>(
        `${SUNO_RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`,
        {
          headers: { Authorization: `Bearer ${API_KEY}` },
          timeout: 20000,
        }
      );
      return res.data;
    } catch (err: any) {
      logger.warn('suno', `getRecordInfo failed for ${taskId}`, err?.response?.data || err?.message);
      throw err;
    }
  },
};

function normStatus(data: SunoRecordInfoResponse['data']): string {
  return (data?.status || '').trim().toUpperCase();
}

/** Успех: все варианты дорожек готовы (см. KIE record-info). */
export function isSunoCompleted(data: SunoRecordInfoResponse['data']): boolean {
  const s = normStatus(data);
  return s === 'SUCCESS' || s === 'COMPLETE';
}

/** Первый вариант уже в sunoData, второй ещё генерируется — не финал. */
export function isSunoFirstSuccess(data: SunoRecordInfoResponse['data']): boolean {
  return normStatus(data) === 'FIRST_SUCCESS';
}

const SUNO_STILL_POLLING = new Set([
  '',
  'PENDING',
  'TEXT_SUCCESS',
  'FIRST_SUCCESS',
]);

const SUNO_TERMINAL_FAIL = new Set([
  'SENSITIVE_WORD_ERROR',
  'CREATE_TASK_FAILED',
  'GENERATE_AUDIO_FAILED',
  'CALLBACK_EXCEPTION',
]);

/**
 * Терминальный сбой: явный список + эвристика по подстрокам.
 * Промежуточные TEXT_SUCCESS / FIRST_SUCCESS не считаем ошибкой (есть в SUNO_STILL_POLLING).
 * Для произвольных статусов с FAIL/ERROR, но со словом SUCCESS (например *_SUCCESS), не отрезаем — оставляем поллинг.
 */
export function isSunoFailed(data: SunoRecordInfoResponse['data']): { failed: true; reason: string } | { failed: false } {
  if (!data) return { failed: false };
  const s = normStatus(data);
  if (SUNO_STILL_POLLING.has(s) || isSunoCompleted(data)) return { failed: false };
  if (SUNO_TERMINAL_FAIL.has(s)) {
    return {
      failed: true,
      reason: data.errorMessage || data.status || 'unknown',
    };
  }
  if ((s.includes('FAIL') || s.includes('ERROR')) && !s.includes('SUCCESS')) {
    return {
      failed: true,
      reason: data.errorMessage || data.status || 'unknown',
    };
  }
  logger.warn('suno', 'Unknown Suno status, continue polling', { status: data.status, taskId: data.taskId });
  return { failed: false };
}
