import { Keyboard } from '@maxhub/max-bot-api';
import { User, db_helper } from '../db';

export function getPhotoPromptMenuText(user: User) {
  const n = user.photo_prompt_upload_count ?? 0;
  return (
    `📸 Анализ фото → Промпт\n\n` +
    `🍌 Баланс: ${user.balance} 🍌\n\n` +
    `📷 Отправлено фото: ${n}\n\n` +
    `Отправьте фото для анализа.\n` +
    `🤖 ИИ создаст точный промпт для повторения:\n` +
    `• Лица и люди\n` +
    `• Позы и одежда\n` +
    `• Освещение и фон\n\n` +
    `Это бесплатно!`
  );
}

export function getPhotoPromptMenuKeyboard() {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback('⬅️ Назад', 'main_menu')]]);
}

export async function showPhotoPromptMenu(ctx: any) {
  if (!ctx.user) return;
  const userId = ctx.user.user_id.toString();
  const user = db_helper.getUser(userId);
  if (!user) return;

  db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'awaiting_photo');

  // mid карточки с кнопками (из callback); при отправке фото ctx.messageId — уже id сообщения пользователя
  const menuMid =
    ctx.messageId ?? (ctx.message && 'body' in ctx.message ? (ctx.message as { body: { mid?: string } }).body?.mid : undefined);
  if (menuMid !== undefined && menuMid !== null && menuMid !== '') {
    db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', String(menuMid));
  }

  const fresh = db_helper.getUser(userId)!;

  await ctx.editMessage({
    text: getPhotoPromptMenuText(fresh),
    attachments: [getPhotoPromptMenuKeyboard()]
  });
}
