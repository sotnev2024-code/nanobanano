import { logger } from './logger';

const MAX_API_BASE = (process.env.MAX_API_BASE || 'https://platform-api2.max.ru').trim();

/** Все типы апдейтов, которые сейчас обрабатывает бот. */
const DEFAULT_UPDATE_TYPES = [
  'message_created',
  'message_callback',
  'bot_started',
  'bot_added',
  'bot_removed',
  'user_added',
  'user_removed',
  'chat_title_changed',
];

export interface SubscriptionInfo {
  url: string;
  time?: number;
  update_types?: string[];
  version?: string;
}

interface MaxApiError {
  code?: string;
  message?: string;
}

async function callMax(
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: object,
  query?: Record<string, string>
): Promise<{ status: number; data: unknown }> {
  const url = new URL(path, MAX_API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(url.href, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* пустой ответ */
  }
  return { status: res.status, data };
}

/**
 * Регистрирует webhook на стороне MAX.
 * См. https://dev.max.ru/docs-api/methods/POST/subscriptions
 */
export async function registerWebhook(
  token: string,
  webhookUrl: string,
  secret: string,
  updateTypes: string[] = DEFAULT_UPDATE_TYPES
): Promise<void> {
  if (!webhookUrl.startsWith('https://')) {
    throw new Error(`Webhook URL must start with https://: got ${webhookUrl}`);
  }
  // Сначала смотрим текущие подписки — чтобы при перезапуске не плодить дубли.
  const existing = await listWebhooks(token);
  if (existing.some((s) => s.url === webhookUrl)) {
    logger.info('webhook', 'MAX webhook already registered (skipping)', webhookUrl);
    return;
  }

  const body: Record<string, unknown> = {
    url: webhookUrl,
    update_types: updateTypes,
  };
  if (secret) body.secret = secret;

  const reg = await callMax(token, 'POST', '/subscriptions', body);
  if (reg.status >= 200 && reg.status < 300) {
    logger.info('webhook', `MAX webhook registered: ${webhookUrl}`, {
      updateTypes,
      hasSecret: Boolean(secret),
    });
    return;
  }
  const err = (reg.data as MaxApiError) || {};
  throw new Error(
    `Failed to register MAX webhook (status ${reg.status}): ${err.message || JSON.stringify(reg.data)}`
  );
}

/** Удаляет webhook (нужно при переключении на polling или смене URL). */
export async function deleteWebhook(token: string, webhookUrl: string): Promise<void> {
  const { status } = await callMax(token, 'DELETE', '/subscriptions', undefined, { url: webhookUrl });
  if (status >= 200 && status < 300) {
    logger.info('webhook', `MAX webhook removed: ${webhookUrl}`);
    return;
  }
  logger.warn('webhook', `Failed to delete MAX webhook (status ${status})`, webhookUrl);
}

/** Получить список подписок (для отладки). */
export async function listWebhooks(token: string): Promise<SubscriptionInfo[]> {
  const { status, data } = await callMax(token, 'GET', '/subscriptions');
  if (status === 200 && Array.isArray((data as { subscriptions?: unknown })?.subscriptions)) {
    return (data as { subscriptions: SubscriptionInfo[] }).subscriptions;
  }
  return [];
}
