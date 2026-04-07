import { db_helper } from '../db';

function formatDetails(data: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  if (typeof data === 'string') return data.slice(0, 4000);
  try {
    return JSON.stringify(data, null, 2).slice(0, 4000);
  } catch {
    return String(data).slice(0, 4000);
  }
}

export const logger = {
  error: (type: string, message: string, details?: unknown, userId?: string): void => {
    const det = formatDetails(details);
    console.error(`[ERROR][${type}] ${message}`, details ?? '');
    try {
      db_helper.writeLog('error', type, message, det, userId);
    } catch (e) {
      console.error('Logger DB write failed:', e);
    }
  },

  warn: (type: string, message: string, details?: unknown, userId?: string): void => {
    const det = formatDetails(details);
    console.warn(`[WARN][${type}] ${message}`, details ?? '');
    try {
      db_helper.writeLog('warn', type, message, det, userId);
    } catch (e) {
      console.error('Logger DB write failed:', e);
    }
  },

  info: (type: string, message: string, details?: unknown): void => {
    const det = formatDetails(details);
    console.log(`[INFO][${type}] ${message}`, details ?? '');
    try {
      db_helper.writeLog('info', type, message, det);
    } catch (e) {
      console.error('Logger DB write failed:', e);
    }
  },
};
