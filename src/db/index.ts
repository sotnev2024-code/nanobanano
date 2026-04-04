import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = path.resolve(process.cwd(), process.env.DATABASE_URL || 'database.sqlite');
const db = new Database(dbPath);

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 10,
    video_mode TEXT DEFAULT 'text_to_video',
    video_model TEXT DEFAULT 'kling_3_std',
    video_ratio TEXT DEFAULT '16:9',
    video_duration TEXT DEFAULT '5 сек',
    is_awaiting_prompt INTEGER DEFAULT 0,
    is_awaiting_media INTEGER DEFAULT 0,
    stored_image_url TEXT,
    stored_video_url TEXT,
    last_task_id TEXT,
    is_admin_adding_bananas INTEGER DEFAULT 0,
    is_admin_broadcasting INTEGER DEFAULT 0,
    photo_references TEXT DEFAULT '[]',
    photo_state TEXT DEFAULT 'idle',
    motion_state TEXT DEFAULT 'idle',
    motion_quality TEXT DEFAULT 'std',
    photo_prompt_state TEXT DEFAULT 'idle',
    pending_payment_id TEXT,
    pending_bananas INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    model TEXT,
    status TEXT,
    task_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS photo_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    model TEXT,
    status TEXT,
    task_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    user_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Ensure columns exist for older versions of the table
const columns = [
  { name: 'video_mode', type: 'TEXT DEFAULT \'text_to_video\'' },
  { name: 'video_model', type: 'TEXT DEFAULT \'kling_3_std\'' },
  { name: 'video_ratio', type: 'TEXT DEFAULT \'16:9\'' },
  { name: 'video_duration', type: 'TEXT DEFAULT \'5 сек\'' },
  { name: 'is_awaiting_prompt', type: 'INTEGER DEFAULT 0' },
  { name: 'is_awaiting_media', type: 'INTEGER DEFAULT 0' },
  { name: 'stored_image_url', type: 'TEXT' },
  { name: 'stored_video_url', type: 'TEXT' },
  { name: 'last_task_id', type: 'TEXT' },
  { name: 'is_admin_adding_bananas', type: 'INTEGER DEFAULT 0' },
  { name: 'is_admin_broadcasting', type: 'INTEGER DEFAULT 0' },
  { name: 'photo_references', type: 'TEXT DEFAULT \'[]\'' },
  { name: 'photo_state', type: 'TEXT DEFAULT \'idle\'' },
  { name: 'motion_state', type: 'TEXT DEFAULT \'idle\'' },
  { name: 'motion_quality', type: 'TEXT DEFAULT \'std\'' },
  { name: 'photo_prompt_state', type: 'TEXT DEFAULT \'idle\'' },
  { name: 'pending_payment_id', type: 'TEXT' },
  { name: 'pending_bananas', type: 'INTEGER DEFAULT 0' },
  { name: 'grok_mode', type: "TEXT DEFAULT 'normal'" },
  { name: 'photo_prompt_upload_count', type: 'INTEGER DEFAULT 0' },
  { name: 'photo_prompt_menu_message_id', type: 'TEXT' },
  { name: 'photo_menu_message_id', type: 'TEXT' },
  { name: 'photo_kie_model', type: 'TEXT' },
  { name: 'photo_gen_json', type: "TEXT DEFAULT '{}'" },
  { name: 'video_gen_json', type: "TEXT DEFAULT '{}'" },
  { name: 'is_banned', type: 'INTEGER DEFAULT 0' }
];

const generationColumns = [
  { name: 'prompt', type: 'TEXT' }
];

for (const col of generationColumns) {
  try { db.exec(`ALTER TABLE generations ADD COLUMN ${col.name} ${col.type}`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE photo_generations ADD COLUMN ${col.name} ${col.type}`); } catch { /* exists */ }
}

for (const col of columns) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
  } catch (e) {
    // Column already exists
  }
}

export interface User {
  id: string;
  balance: number;
  video_mode: string;
  video_model: string;
  video_ratio: string;
  video_duration: string;
  is_awaiting_prompt: number; // 0 or 1
  is_awaiting_media: number; // 0 or 1
  stored_image_url: string | null;
  stored_video_url: string | null;
  last_task_id: string | null;
  is_admin_adding_bananas: number; // 0 or 1
  is_admin_broadcasting: number; // 0 or 1
  photo_references: string; // JSON array of strings
  photo_state: string; // 'idle', 'awaiting_refs', 'awaiting_photo_model' (модель+формат+промпт в чат)
  motion_state: string; // 'idle', 'awaiting_photo', 'awaiting_video'
  motion_quality: string; // 'std', 'pro'
  photo_prompt_state: string; // 'idle', 'awaiting_photo'
  pending_payment_id: string | null;
  pending_bananas: number;
  grok_mode: string; // 'fun' | 'normal'
  photo_prompt_upload_count: number;
  photo_prompt_menu_message_id: string | null;
  photo_menu_message_id: string | null;
  photo_kie_model: string | null;
  photo_gen_json: string | null;
  video_gen_json: string | null;
  is_banned: number; // 0 or 1
  created_at: string;
}

export interface LogEntry {
  id: number;
  level: string;
  type: string;
  message: string;
  details: string | null;
  user_id: string | null;
  created_at: string;
}

export const db_helper = {
  getUser: (userId: string): User | undefined => {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(userId) as User | undefined;
  },

  createUser: (userId: string, initialBalance: number = 10): User => {
    const stmt = db.prepare("INSERT INTO users (id, balance, is_awaiting_prompt, is_awaiting_media, photo_references, photo_state, motion_state, motion_quality, photo_prompt_state) VALUES (?, ?, 0, 0, '[]', 'idle', 'idle', 'std', 'idle')");
    stmt.run(userId, initialBalance);
    return db_helper.getUser(userId) as User;
  },

  updateBalance: (userId: string, amount: number): void => {
    const stmt = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
    stmt.run(amount, userId);
  },

  setBalance: (userId: string, balance: number): void => {
    const stmt = db.prepare('UPDATE users SET balance = ? WHERE id = ?');
    stmt.run(balance, userId);
  },

  updateVideoSetting: (userId: string, key: 'video_mode' | 'video_model' | 'video_ratio' | 'video_duration' | 'is_awaiting_prompt' | 'is_awaiting_media' | 'stored_image_url' | 'stored_video_url' | 'last_task_id' | 'is_admin_adding_bananas' | 'is_admin_broadcasting' | 'photo_references' | 'photo_state' | 'motion_state' | 'motion_quality' | 'photo_prompt_state' | 'grok_mode' | 'photo_prompt_upload_count' | 'photo_prompt_menu_message_id' | 'photo_menu_message_id' | 'photo_kie_model' | 'photo_gen_json' | 'video_gen_json', value: string | number | null): void => {
    const stmt = db.prepare(`UPDATE users SET ${key} = ? WHERE id = ?`);
    stmt.run(value, userId);
  },

  logGeneration: (userId: string, model: string, status: string, taskId: string, prompt?: string): void => {
    const stmt = db.prepare('INSERT INTO generations (user_id, model, status, task_id, prompt) VALUES (?, ?, ?, ?, ?)');
    stmt.run(userId, model, status, taskId, prompt ?? null);
  },

  logPhotoGeneration: (userId: string, model: string, status: string, taskId: string, prompt?: string): void => {
    const stmt = db.prepare('INSERT INTO photo_generations (user_id, model, status, task_id, prompt) VALUES (?, ?, ?, ?, ?)');
    stmt.run(userId, model, status, taskId, prompt ?? null);
  },

  banUser: (userId: string): void => {
    db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(userId);
  },

  unbanUser: (userId: string): void => {
    db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(userId);
  },

  isUserBanned: (userId: string): boolean => {
    const row = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(userId) as { is_banned: number } | undefined;
    return row?.is_banned === 1;
  },

  updateGenerationStatus: (taskId: string, status: string): void => {
    const stmt = db.prepare('UPDATE generations SET status = ? WHERE task_id = ?');
    stmt.run(status, taskId);
  },

  updatePhotoGenerationStatus: (taskId: string, status: string): void => {
    const stmt = db.prepare('UPDATE photo_generations SET status = ? WHERE task_id = ?');
    stmt.run(status, taskId);
  },

  savePayment: (userId: string, paymentId: string, bananas: number): void => {
    db.prepare('UPDATE users SET pending_payment_id = ?, pending_bananas = ? WHERE id = ?')
      .run(paymentId, bananas, userId);
  },

  clearPayment: (userId: string): void => {
    db.prepare('UPDATE users SET pending_payment_id = NULL, pending_bananas = 0 WHERE id = ?')
      .run(userId);
  },

  getAllUserIds: (): string[] => {
    const rows = db.prepare('SELECT id FROM users').all() as { id: string }[];
    return rows.map(r => r.id);
  },

  getAllUsersWithStats: (): Array<{
    id: string;
    balance: number;
    created_at: string;
    video_total: number;
    video_success: number;
    photo_total: number;
    photo_success: number;
  }> => {
    return db.prepare(`
      SELECT
        u.id,
        u.balance,
        u.created_at,
        COALESCE(v.total, 0)   AS video_total,
        COALESCE(v.success, 0) AS video_success,
        COALESCE(p.total, 0)   AS photo_total,
        COALESCE(p.success, 0) AS photo_success
      FROM users u
      LEFT JOIN (
        SELECT user_id,
               COUNT(*)                                          AS total,
               SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success
        FROM generations GROUP BY user_id
      ) v ON v.user_id = u.id
      LEFT JOIN (
        SELECT user_id,
               COUNT(*)                                          AS total,
               SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success
        FROM photo_generations GROUP BY user_id
      ) p ON p.user_id = u.id
      ORDER BY u.created_at DESC
    `).all() as any[];
  },

  writeLog: (level: 'error' | 'warn' | 'info', type: string, message: string, details?: string, userId?: string): void => {
    db.prepare('INSERT INTO logs (level, type, message, details, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(level, type, message, details ?? null, userId ?? null);
  },

  getLogs: (limit = 30, level?: string): LogEntry[] => {
    if (level) {
      return db.prepare('SELECT * FROM logs WHERE level = ? ORDER BY created_at DESC LIMIT ?')
        .all(level, limit) as LogEntry[];
    }
    return db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as LogEntry[];
  },

  /** Все записи видео-генераций с промптами (для выгрузки админом). */
  getGenerationsForPromptExport: (): Array<{
    id: number;
    user_id: string | null;
    model: string;
    status: string;
    task_id: string;
    prompt: string | null;
    created_at: string;
  }> => {
    return db
      .prepare(
        'SELECT id, user_id, model, status, task_id, prompt, created_at FROM generations ORDER BY created_at DESC'
      )
      .all() as any[];
  },

  /** Все записи фото-генераций с промптами. */
  getPhotoGenerationsForPromptExport: (): Array<{
    id: number;
    user_id: string | null;
    model: string;
    status: string;
    task_id: string;
    prompt: string | null;
    created_at: string;
  }> => {
    return db
      .prepare(
        'SELECT id, user_id, model, status, task_id, prompt, created_at FROM photo_generations ORDER BY created_at DESC'
      )
      .all() as any[];
  },

  /** Логи блокировки промптов (type = moderation). */
  getModerationLogsForExport: (): LogEntry[] => {
    return db
      .prepare("SELECT * FROM logs WHERE type = 'moderation' ORDER BY created_at DESC")
      .all() as LogEntry[];
  },

  clearLogs: (): void => {
    db.prepare('DELETE FROM logs').run();
  },

  getStats: () => {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
    const totalGenerations = db.prepare('SELECT COUNT(*) as count FROM generations').get() as any;
    const totalPhotoGenerations = db.prepare('SELECT COUNT(*) as count FROM photo_generations').get() as any;
    const successGenerations = db.prepare("SELECT COUNT(*) as count FROM generations WHERE status = 'success'").get() as any;
    const failGenerations = db.prepare("SELECT COUNT(*) as count FROM generations WHERE status = 'fail'").get() as any;
    
    return {
      totalUsers: totalUsers.count,
      totalGenerations: totalGenerations.count + totalPhotoGenerations.count,
      successGenerations: successGenerations.count,
      failGenerations: failGenerations.count
    };
  },

  getDailyReport: (datePrefix: string) => {
    const newUsers = (db.prepare("SELECT COUNT(*) as count FROM users WHERE created_at LIKE ?").get(`${datePrefix}%`) as any).count;

    const videoRows = db.prepare("SELECT model, status, COUNT(*) as count FROM generations WHERE created_at LIKE ? GROUP BY model, status").all(`${datePrefix}%`) as any[];
    const photoRows = db.prepare("SELECT status, COUNT(*) as count FROM photo_generations WHERE created_at LIKE ? GROUP BY status").all(`${datePrefix}%`) as any[];

    const errorRows = db.prepare("SELECT type, message, COUNT(*) as count FROM logs WHERE level = 'error' AND created_at LIKE ? GROUP BY type, message ORDER BY count DESC LIMIT 10").all(`${datePrefix}%`) as any[];
    const warnRows = (db.prepare("SELECT COUNT(*) as count FROM logs WHERE level = 'warn' AND created_at LIKE ?").get(`${datePrefix}%`) as any).count;
    const infoRows = (db.prepare("SELECT COUNT(*) as count FROM logs WHERE level = 'info' AND created_at LIKE ?").get(`${datePrefix}%`) as any).count;

    return { newUsers, videoRows, photoRows, errorRows, warnCount: warnRows, infoCount: infoRows };
  }
};

export default db;
