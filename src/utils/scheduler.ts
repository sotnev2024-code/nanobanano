import cron from 'node-cron';
import { db_helper } from '../db';
import { logger } from './logger';

const REPORT_RECIPIENT = '188305560';

function buildDailyReport(datePrefix: string, displayDate: string): string {
  const data = db_helper.getDailyReport(datePrefix);

  // Video generations summary
  const videoByModel: Record<string, { success: number; fail: number; total: number }> = {};
  for (const row of data.videoRows) {
    if (!videoByModel[row.model]) videoByModel[row.model] = { success: 0, fail: 0, total: 0 };
    if (row.status === 'success') videoByModel[row.model].success += row.count;
    else if (row.status === 'fail') videoByModel[row.model].fail += row.count;
    videoByModel[row.model].total += row.count;
  }

  const totalVideos = data.videoRows.reduce((s: number, r: any) => s + r.count, 0);
  const successVideos = data.videoRows.filter((r: any) => r.status === 'success').reduce((s: number, r: any) => s + r.count, 0);
  const failVideos = data.videoRows.filter((r: any) => r.status === 'fail').reduce((s: number, r: any) => s + r.count, 0);

  const photoSuccess = data.photoRows.filter((r: any) => r.status === 'success').reduce((s: number, r: any) => s + r.count, 0);
  const photoFail = data.photoRows.filter((r: any) => r.status === 'fail').reduce((s: number, r: any) => s + r.count, 0);
  const totalPhotos = photoSuccess + photoFail;

  let text = `📊 Ежедневный отчёт — ${displayDate}\n`;
  text += `${'─'.repeat(32)}\n\n`;

  text += `👥 Новых пользователей: ${data.newUsers}\n\n`;

  text += `🎬 Видео генераций: ${totalVideos}\n`;
  text += `   ✅ Успешно: ${successVideos}  ❌ Ошибок: ${failVideos}\n`;

  if (Object.keys(videoByModel).length > 0) {
    text += `   По моделям:\n`;
    for (const [model, stat] of Object.entries(videoByModel)) {
      text += `   • ${model}: ${stat.total} (✅${stat.success} ❌${stat.fail})\n`;
    }
  }

  text += `\n📸 Фото генераций: ${totalPhotos}\n`;
  text += `   ✅ Успешно: ${photoSuccess}  ❌ Ошибок: ${photoFail}\n`;

  text += `\n🪵 Логи за день:\n`;
  text += `   🔴 Ошибок: ${data.errorRows.reduce((s: number, r: any) => s + r.count, 0)}\n`;
  text += `   🟡 Предупреждений: ${data.warnCount}\n`;
  text += `   🔵 Инфо: ${data.infoCount}\n`;

  if (data.errorRows.length > 0) {
    text += `\n🔴 Топ ошибок:\n`;
    for (const row of data.errorRows) {
      text += `   • [${row.type}] ${row.message.slice(0, 80)} — ${row.count}×\n`;
    }
  }

  text += `\n${'─'.repeat(32)}\n`;
  text += `🤖 Отчёт сформирован автоматически`;

  return text;
}

export function startScheduler(sendToUser: (userId: string, text: string) => Promise<void>): void {
  // Every day at 21:00 Moscow time (UTC+3 = 18:00 UTC)
  cron.schedule('0 18 * * *', async () => {
    try {
      // Moscow date at report time
      const now = new Date();
      const mskOffset = 3 * 60 * 60 * 1000;
      const mskDate = new Date(now.getTime() + mskOffset);
      const datePrefix = mskDate.toISOString().slice(0, 10); // YYYY-MM-DD
      const displayDate = datePrefix.split('-').reverse().join('.');

      const report = buildDailyReport(datePrefix, displayDate);
      await sendToUser(REPORT_RECIPIENT, report);
      logger.info('scheduler', `Daily report sent for ${datePrefix}`);
    } catch (err) {
      logger.error('scheduler', 'Failed to send daily report', err);
    }
  }, {
    timezone: 'UTC'
  });

  logger.info('scheduler', 'Daily report scheduler started (21:00 MSK)');
}
