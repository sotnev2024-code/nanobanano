import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

const API_KEY = process.env.api_key;
const BASE_URL = 'https://api.kie.ai/api/v1/jobs';
/** Kie file hosting (see https://docs.kie.ai/file-upload-api/quickstart) */
const KIE_FILE_BASE = 'https://kieai.redpandaai.co';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
});

export interface CreateTaskParams {
  model: string;
  input: Record<string, any>;
  callBackUrl?: string;
}

export interface TaskResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
  };
}

export interface RecordInfoResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
    model: string;
    state: 'waiting' | 'success' | 'fail';
    param: string;
    resultJson: string | null;
    failCode: string | null;
    failMsg: string | null;
    costTime: number | null;
    completeTime: number | null;
    createTime: number;
  };
}

export interface VeoRecordInfoResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
    successFlag: 0 | 1 | 2 | 3; // 0=generating, 1=success, 2=failed, 3=generation failed
    response: {
      taskId: string;
      resultUrls: string[] | null;
      originUrls: string[] | null;
      resolution: string;
    } | null;
    errorCode: number | null;
    errorMessage: string | null;
    createTime: number;
    completeTime: number | null;
  } | null;
}

interface KieUploadData {
  fileUrl?: string;
  downloadUrl?: string;
}

interface KieUploadResponse {
  success?: boolean;
  code?: number;
  msg?: string;
  data?: KieUploadData & { success?: boolean };
}

function pickKieUploadedUrl(data: KieUploadData | undefined): string | undefined {
  if (!data) return undefined;
  return data.fileUrl || data.downloadUrl;
}

/**
 * Motion Control / Kie jobs expect URLs from Kie file upload, not raw messenger CDN links.
 */
export async function uploadMediaUrlForKie(
  sourceUrl: string,
  fileName: string
): Promise<string> {
  if (!API_KEY) throw new Error('api_key is not set');
  const cleanUrl = sourceUrl.replace(/[`'"]/g, '').trim();
  if (!cleanUrl) throw new Error('Empty source URL');

  const auth = { Authorization: `Bearer ${API_KEY}` };

  const tryUrlUpload = async (): Promise<string | null> => {
    try {
      const { data } = await axios.post<KieUploadResponse>(
        `${KIE_FILE_BASE}/api/file-url-upload`,
        {
          fileUrl: cleanUrl,
          uploadPath: 'bot-max',
          fileName
        },
        { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 60000 }
      );
      const url = pickKieUploadedUrl(data?.data);
      if (url && (data.success === true || data.code === 200)) return url;
      return null;
    } catch {
      return null;
    }
  };

  const fromUrl = await tryUrlUpload();
  if (fromUrl) return fromUrl;

  const dl = await axios.get<ArrayBuffer>(cleanUrl, {
    responseType: 'arraybuffer',
    maxContentLength: 100 * 1024 * 1024,
    maxBodyLength: 100 * 1024 * 1024,
    timeout: 120000
  });
  const buffer = Buffer.from(dl.data);
  const blob = new Blob([buffer]);
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('uploadPath', 'bot-max');
  form.append('fileName', fileName);

  const res = await fetch(`${KIE_FILE_BASE}/api/file-stream-upload`, {
    method: 'POST',
    headers: auth,
    body: form
  });
  const json = (await res.json()) as KieUploadResponse;
  const out = pickKieUploadedUrl(json?.data);
  const ok =
    res.ok &&
    (json.success === true || json.code === 200) &&
    !!out;
  if (!ok) {
    logger.error('kie_upload', 'Stream upload failed', { status: res.status, json });
    throw new Error(json?.msg || `Kie file upload failed (${res.status})`);
  }
  return out;
}

export const kie_api = {
  createTask: async (params: CreateTaskParams): Promise<TaskResponse> => {
    const isVeo = params.model === 'veo3_fast' || params.model === 'veo3';
    if (isVeo) {
      // Veo API expects a flat body: { model, prompt, imageUrls, ... }
      const body = { model: params.model, ...params.input };
      const response = await api.post('https://api.kie.ai/api/v1/veo/generate', body);
      return response.data;
    }
    const body: Record<string, unknown> = {
      model: params.model,
      input: params.input
    };
    body.callBackUrl =
      params.callBackUrl ||
      process.env.KIE_CALLBACK_URL ||
      'https://example.com/kie-callback';
    const response = await api.post('/createTask', body);
    return response.data;
  },

  getRecordInfo: async (taskId: string): Promise<RecordInfoResponse> => {
    const response = await api.get(`/recordInfo?taskId=${taskId}`);
    return response.data;
  },

  getVeoRecordInfo: async (taskId: string): Promise<VeoRecordInfoResponse> => {
    const response = await api.get(`https://api.kie.ai/api/v1/veo/record-info?taskId=${taskId}`);
    return response.data;
  },

  analyzeImage: async (imageUrl: string): Promise<string> => {
    try {
      const response = await axios.post(
        'https://api.kie.ai/gemini-2.5-pro/v1/chat/completions',
        {
          stream: false,
          include_thoughts: false,
          reasoning_effort: 'low',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Проанализируй это фото и напиши подробный промпт на РУССКОМ языке для генерации похожего изображения в ИИ-генераторе. Опиши: объекты и их внешность, одежду, позы и выражения лиц, освещение (направление, цвет, качество), фон и окружение, ракурс камеры, глубину резкости, стиль, цветовую палитру, настроение и атмосферу. Верни ТОЛЬКО текст промпта, без объяснений и лишних комментариев.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl
                  }
                }
              ]
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('gemini', 'Gemini raw response', response.data);

      // Standard OpenAI-compatible format: choices[0].message.content (string)
      const content = response.data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return content.trim();
      }
      // content may be an array of parts: [{ type: 'text', text: '...' }]
      if (Array.isArray(content)) {
        const text = content.map((p: any) => p?.text || '').join('').trim();
        if (text) return text;
      }
      // Some APIs return result directly in data.text or data.content
      if (typeof response.data?.text === 'string' && response.data.text.trim()) {
        return response.data.text.trim();
      }
      if (typeof response.data?.content === 'string' && response.data.content.trim()) {
        return response.data.content.trim();
      }

      logger.error('gemini', 'Unrecognised Gemini response structure', response.data);
      throw new Error('Invalid response from Gemini API');
    } catch (error: any) {
      logger.error('gemini', 'Gemini API error', error.response?.data || error.message);
      throw error;
    }
  },

  // Map our internal model IDs to Kie AI model identifiers
  mapModel: (internalId: string): string => {
    const map: Record<string, string> = {
      'kling_3_std': 'kling-3.0/video',
      'kling_3_pro': 'kling-3.0/video',
      'kling_2.6_motion': 'kling-2.6/motion-control',
      'kling_3_motion': 'kling-3.0/motion-control',
      'seedance_1.5_pro': 'bytedance/seedance-1.5-pro',
      'seedance_2': 'bytedance/seedance-2',
      'hailuo_2.3': 'hailuo/2-3-image-to-video-pro',
      'veo_3.1': 'veo3_fast',
      'grok_img2video': 'grok-imagine/image-to-video',
      'ai_avatar_pro': 'kling/ai-avatar-pro',
      'from_audio': 'infinitalk/from-audio'
    };
    return map[internalId] || internalId;
  }
};
