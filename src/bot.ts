import { Bot, Keyboard, VideoAttachment, FileAttachment } from '@maxhub/max-bot-api';
import { db_helper } from './db';
import {
  getVideoMenuText,
  getVideoMenuKeyboard,
  modelMap,
  getVideoCost,
  parseVideoGenPrefs,
  saveVideoGenPrefs,
  DEFAULT_VIDEO_GEN_PREFS
} from './handlers/video';
import {
  getPhotoMenuText,
  getPhotoMenuKeyboard,
  persistPhotoMenuMessageId,
  PHOTO_CALLBACK_TO_MODEL,
  PHOTO_MODEL_META,
  PHOTO_AR_CALLBACK_PAYLOADS,
  photoCallbackToAspectRatio,
  defaultPhotoGenPrefs,
  savePhotoGenPrefs,
  parsePhotoGenPrefs,
  getPhotoGenerationBananaCost,
  buildPhotoCreateTaskParams,
  primePhotoConfigureStep,
  type PhotoKieModelId
} from './handlers/photo';
import { getMotionControlText, getMotionControlKeyboard } from './handlers/motion';
import {
  showPhotoPromptMenu,
  getPhotoPromptMenuText,
  getPhotoPromptMenuKeyboard
} from './handlers/photo_prompt';
import { getAdminPanelText, getAdminPanelKeyboard } from './handlers/admin';
import { getBillingMenuText, getBillingMenuKeyboard } from './handlers/billing';
import { kie_api, uploadMediaUrlForKie } from './utils/kie_api';
import { tbank, PACKS } from './utils/tbank';
import { logger } from './utils/logger';
import { probeIncomingVideoDuration, tryDurationFromMediaUrl } from './utils/video_duration';
import { startScheduler } from './utils/scheduler';
import ExcelJS from 'exceljs';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ─── Контент-фильтр ─────────────────────────────────────────────────────────
const BANNED_WORDS: string[] = [
  // Сексуальный контент
  'porn', 'porno', 'pornography', 'xxx', 'nsfw', 'nude', 'naked', 'nudity',
  'erotic', 'hentai', 'explicit sex', 'sex scene', 'genitalia', 'genitals',
  'penis', 'vagina', 'breasts naked', 'topless', 'bottomless', 'undress',
  'masturbat', 'orgasm', 'ejaculat', 'cum shot',
  // Детский контент
  'child porn', 'cp ', ' cp ', 'csam', 'lolita', 'underage sex', 'minor naked',
  'minor nude', 'teen naked', 'teen nude', 'child nude', 'child naked',
  'preteen', 'pre-teen', 'pedophil', 'paedophil',
  // Насилие
  'gore', 'snuff', 'necrophil', 'torture porn', 'extreme violence',
  // Русские вариации
  'порно', 'секс видео', 'детское порно', 'голые дети', 'голый ребёнок',
  'педофил', 'инцест', 'раздеть ребён', 'несовершеннолетн',
];

/**
 * Проверяет промпт на запрещённые слова/фразы.
 * Возвращает найденное слово или null если всё чисто.
 */
function checkBannedContent(text: string): string | null {
  const lower = text.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (lower.includes(word.toLowerCase())) return word;
  }
  return null;
}

/** Ожидают одно видео после /probe_video (тест длительности) */
const videoProbePendingUserIds = new Set<string>();

const clearPhotoKieSelection = (userId: string) => {
  db_helper.updateVideoSetting(userId, 'photo_kie_model', null);
  db_helper.updateVideoSetting(userId, 'photo_gen_json', JSON.stringify(defaultPhotoGenPrefs()));
};

const patchPhotoGenPrefs = (userId: string, patch: Partial<import('./handlers/photo').PhotoGenPrefs>) => {
  const u = db_helper.getUser(userId)!;
  savePhotoGenPrefs(userId, { ...parsePhotoGenPrefs(u), ...patch });
};

const refreshPhotoFlowCard = async (ctx: any, userId: string) => {
  persistPhotoMenuMessageId(ctx, userId);
  const user = db_helper.getUser(userId)!;
  return ctx.editMessage({
    text: getPhotoMenuText(user),
    attachments: [getPhotoMenuKeyboard(user)]
  });
};

/**
 * Опрос статуса задач Kie (фото/видео): не обрывать долгие генерации.
 * KIE_POLL_MAX_MINUTES — максимальное время ожидания одной задачи (стена часов).
 * KIE_POLL_INTERVAL_MS — пауза между запросами (не чаще ~раз в 3 с).
 */
const KIE_POLL_INTERVAL_MS = Math.max(
  3000,
  parseInt(process.env.KIE_POLL_INTERVAL_MS || '10000', 10)
);
const KIE_POLL_MAX_MINUTES = Math.max(
  15,
  parseInt(process.env.KIE_POLL_MAX_MINUTES || '120', 10)
);
const KIE_POLL_MAX_ATTEMPTS = Math.ceil(
  (KIE_POLL_MAX_MINUTES * 60 * 1000) / KIE_POLL_INTERVAL_MS
);

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is not defined in .env');
}

const admins = (process.env.admins || '').split(',').map(id => id.trim());
const isAdmin = (userId: string) => admins.includes(userId);

/** user_id в рантайме у Max есть; типы `ctx.user` в SDK неполные (strict TS даёт `never`). */
function maxCtxUserId(ctx: { user?: unknown }): string {
  const u = ctx.user as { user_id?: number | string | bigint } | undefined;
  if (u == null || u.user_id == null) return '';
  return String(u.user_id);
}

const bot = new Bot(token);

// --- HELPERS ---
const sanitizeUrl = (url: string): string => {
  if (!url) return url;
  return url.replace(/[`'\"]/g, '').trim();
};

/** Kie models с audio_url: только аудио, не video (Avatar Pro, InfiniTalk from-audio) */
const KIE_AUDIO_FILENAME_RE = /\.(mp3|wav|m4a|aac|ogg|flac|opus|amr|3gp|webm)$/i;

function extractKieAudioAttachmentUrl(attachment: {
  type: string;
  payload?: { url?: string };
  filename?: string;
}): string | null {
  if (attachment.type === 'audio') {
    const u = attachment.payload?.url;
    return u ? sanitizeUrl(u) : null;
  }
  if (attachment.type === 'file') {
    const fn = String((attachment as { filename?: string }).filename || '');
    if (KIE_AUDIO_FILENAME_RE.test(fn)) {
      const u = attachment.payload?.url;
      return u ? sanitizeUrl(u) : null;
    }
  }
  return null;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Отправляет готовое видео пользователю.
 * Пытается загрузить видео на Max Bot и отправить встроенным плеером.
 * При ошибке загрузки — отправляет текст со ссылкой.
 */
const sendVideoResult = async (ctx: any, videoUrl: string, modelName: string, cost: number) => {
  const text = `✅ Ваше видео готово!\n🎯 Пресет: ${modelName}`;
  const buttons = Keyboard.inlineKeyboard([
    [Keyboard.button.link('⬇️ Скачать видео', videoUrl)],
    [Keyboard.button.callback('🏠 Главное меню', 'main_menu_reply')]
  ]);
  try {
    const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120_000 });
    const videoBuffer = Buffer.from(videoResponse.data);
    const uploaded = await bot.api.uploadVideo({ source: videoBuffer, timeout: 120_000 });
    const videoAttach = new VideoAttachment({ token: uploaded.token });
    await ctx.reply(text, { attachments: [videoAttach.toJson(), buttons] });
  } catch (uploadErr) {
    logger.warn('video_send', 'Video upload to Max failed, sending link', uploadErr);
    await ctx.reply(`${text}\n\n🔗 ${videoUrl}`, { attachments: [buttons] });
  }
};

const pollPhotoTaskStatus = async (ctx: any, taskId: string, userId: string, cost: number) => {
  db_helper.updateBalance(userId, -cost);
  const refundPhoto = () => db_helper.updateBalance(userId, cost);

  let attempts = 0;
  const maxAttempts = KIE_POLL_MAX_ATTEMPTS;

  while (attempts < maxAttempts) {
    try {
      const info = await kie_api.getRecordInfo(taskId);
      if (info.data?.state === 'success') {
        const result = JSON.parse(info.data.resultJson || '{}');
        const imageUrl = result.resultUrls?.[0];
        
        if (imageUrl) {
          db_helper.updatePhotoGenerationStatus(taskId, 'success');
          try {
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(imageResponse.data);
            const uploaded = await bot.api.uploadImage({ source: imageBuffer });
            await ctx.reply(`✅ Фото готово!\n\nСписано: ${cost} 🍌`, {
              attachments: [
                uploaded.toJson(),
                Keyboard.inlineKeyboard([[Keyboard.button.callback('🏠 В меню', 'main_menu_reply')]])
              ]
            });
          } catch {
            await ctx.reply(`✅ Фото готово!\n\n🔗 ${imageUrl}\n\nСписано: ${cost} 🍌`, {
              attachments: [
                Keyboard.inlineKeyboard([[Keyboard.button.callback('🏠 В меню', 'main_menu_reply')]])
              ]
            });
          }
          return;
        }
      } else if (info.data?.state === 'fail') {
        db_helper.updatePhotoGenerationStatus(taskId, 'fail');
        refundPhoto();
        await ctx.reply(
          `❌ Ошибка при генерации фото.\n\n${cost} 🍌 возвращены на баланс.`
        );
        return;
      }
    } catch (e) {
      logger.error('polling', 'Photo polling error', e);
    }
    
    attempts++;
    await sleep(KIE_POLL_INTERVAL_MS);
  }
  
  db_helper.updatePhotoGenerationStatus(taskId, 'fail');
  refundPhoto();
  const bal = db_helper.getUser(userId)?.balance ?? 0;
  await ctx.reply(
    `❌ Генерация фото не завершилась за ${KIE_POLL_MAX_MINUTES} мин.\n\n` +
      `${cost} 🍌 возвращены на баланс (сейчас: ${bal} 🍌).\n\n` +
      `При необходимости увеличьте KIE_POLL_MAX_MINUTES в .env.`
  );
};

const pollTaskStatus = async (ctx: any, taskId: string, userId: string, internalModelId: string, cost: number) => {
  db_helper.updateBalance(userId, -cost);
  const refundVideo = () => db_helper.updateBalance(userId, cost);

  let attempts = 0;
  const maxAttempts = KIE_POLL_MAX_ATTEMPTS;
  const modelName = modelMap[internalModelId] || internalModelId;
  const kieModel = kie_api.mapModel(internalModelId);
  const isVeo = kieModel === 'veo3_fast' || kieModel === 'veo3';

  while (attempts < maxAttempts) {
    try {
      if (isVeo) {
        const info = await kie_api.getVeoRecordInfo(taskId);

        if (!info || !info.data) {
          attempts++;
          await sleep(KIE_POLL_INTERVAL_MS);
          continue;
        }

        if (info.data.successFlag === 1) {
          const videoUrl = info.data.response?.resultUrls?.[0];
          if (videoUrl) {
            db_helper.updateGenerationStatus(taskId, 'success');
            await sendVideoResult(ctx, videoUrl, modelName, cost);
            return;
          }
        } else if (info.data.successFlag === 2 || info.data.successFlag === 3) {
          db_helper.updateGenerationStatus(taskId, 'fail');
          refundVideo();
          await ctx.reply(
            `❌ Ошибка при генерации видео («${modelName}»).\n\n${cost} 🍌 возвращены на баланс.`
          );
          return;
        }
        // successFlag === 0 means still generating, continue polling
      } else {
        const info = await kie_api.getRecordInfo(taskId);

        if (!info || !info.data) {
          attempts++;
          await sleep(KIE_POLL_INTERVAL_MS);
          continue;
        }

        if (info.data.state === 'success') {
          const result = JSON.parse(info.data.resultJson || '{}');
          const videoUrl = result.resultUrls?.[0];
          
          if (videoUrl) {
            db_helper.updateGenerationStatus(taskId, 'success');
            await sendVideoResult(ctx, videoUrl, modelName, cost);
            return;
          }
        } else if (info.data.state === 'fail') {
          db_helper.updateGenerationStatus(taskId, 'fail');
          refundVideo();
          await ctx.reply(
            `❌ Ошибка при генерации видео («${modelName}»).\n\n${cost} 🍌 возвращены на баланс.`
          );
          return;
        }
      }
    } catch (e) {
      logger.error('polling', 'Video polling error', e);
    }
    
    attempts++;
    await sleep(KIE_POLL_INTERVAL_MS);
  }
  
  db_helper.updateGenerationStatus(taskId, 'fail'); // Consider timeout as fail for stats
  refundVideo();
  const balV = db_helper.getUser(userId)?.balance ?? 0;
  await ctx.reply(
    `❌ Генерация видео («${modelName}») не завершилась за ${KIE_POLL_MAX_MINUTES} мин.\n\n` +
      `${cost} 🍌 возвращены на баланс (сейчас: ${balV} 🍌).\n\n` +
      `Задача могла ещё обрабатываться на сервере — при необходимости проверьте кабинет Kie. ` +
      `Чтобы ждать дольше, увеличьте KIE_POLL_MAX_MINUTES в .env.`
  );
};

// --- HANDLERS ---
bot.on('message_created', async (ctx, next) => {
  if (!ctx.user) return next();

  // Always let commands pass through to their dedicated handlers
  if (ctx.message.body.text?.startsWith('/')) return next();
  
  const userId = maxCtxUserId(ctx);
  const user = db_helper.getUser(userId);
  
  // If user doesn't exist yet, we must allow /start to proceed
  if (!user) return next();

  // ── Проверка бана ──────────────────────────────────────────────────────────
  if (user.is_banned === 1) {
    await ctx.reply('🚫 Ваш аккаунт заблокирован за нарушение правил использования сервиса.');
    return;
  }

  // ── Проверка контента в промптах ───────────────────────────────────────────
  const incomingText = ctx.message.body.text;
  if (incomingText && incomingText.trim().length > 0 && !incomingText.startsWith('/')) {
    const forbidden = checkBannedContent(incomingText);
    if (forbidden) {
      logger.warn(
        'moderation',
        'Banned content blocked',
        JSON.stringify({ userId, word: forbidden, text: incomingText.slice(0, 200) }),
        userId
      );
      await ctx.reply(
        '🚫 Ваш запрос заблокирован — он содержит запрещённый контент.\n\n' +
        'Генерация материалов с насилием, сексуальным или детским контентом запрещена.\n' +
        'При повторных нарушениях аккаунт будет заблокирован.'
      );
      return;
    }
  }

  // Тест: /probe_video → следующим сообщением отправить видео
  if (videoProbePendingUserIds.has(userId)) {
    const attachments = ctx.message.body.attachments || [];
    const videoAtt = attachments.find((a: { type: string }) => a.type === 'video');
    if (!videoAtt) {
      await ctx.reply(
        '📎 Ожидалось видео. Отправьте ролик как видео (не как файл-документ). Чтобы начать заново: /probe_video'
      );
      return;
    }
    videoProbePendingUserIds.delete(userId);
    const result = await probeIncomingVideoDuration(videoAtt);
    const v = videoAtt as Record<string, unknown>;
    const slim = {
      type: v.type,
      duration: v.duration,
      width: v.width,
      height: v.height,
      has_payload_url: !!(v.payload as { url?: string } | undefined)?.url,
      top_level_keys: Object.keys(v)
    };
    const secStr = result.seconds != null ? `${result.seconds.toFixed(2)} с` : '—';
    await ctx.reply(
      `🧪 Проверка видео\n\n` +
        `Длительность: ${secStr}\n` +
        `Источник: ${result.source}\n` +
        `${result.detail ? `${result.detail}\n` : ''}\n` +
        `Поля вложения (что пришло от MAX):\n` +
        `\`\`\`\n${JSON.stringify(slim, null, 2)}\n\`\`\``
    );
    return;
  }

  // Handle admin broadcast: collect content and send to all users
  if (isAdmin(userId) && user.is_admin_broadcasting === 1) {
    const text = ctx.message.body.text || null;
    const attachments = ctx.message.body.attachments;
    const imageAttachment = attachments?.find((a: any) => a.type === 'image');

    if (!text && !imageAttachment) {
      await ctx.reply('❌ Пожалуйста, отправьте текст или фото (можно с подписью).\n\nДля отмены нажмите /start');
      return;
    }

    db_helper.updateVideoSetting(userId, 'is_admin_broadcasting', 0);

    const allIds = db_helper.getAllUserIds();
    let sent = 0;
    let failed = 0;

    await ctx.reply(`⏳ Начинаю рассылку... (${allIds.length} пользователей)`);

    for (const targetId of allIds) {
      try {
        const extra: any = {};
        if (imageAttachment) {
          extra.attachments = [{ type: 'image', payload: { url: (imageAttachment as any).payload.url } }];
        }
        await bot.api.sendMessageToUser(parseInt(targetId), text || '', extra);
        sent++;
      } catch {
        failed++;
      }
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    await ctx.reply(`✅ Рассылка завершена!\n\n📤 Отправлено: ${sent}\n❌ Ошибок: ${failed}`);
    return;
  }

  // Handle admin adding bananas
  if (isAdmin(userId) && user.is_admin_adding_bananas === 1 && ctx.message.body.text) {
    const [targetId, amountStr] = ctx.message.body.text.split(' ');
    const amount = parseInt(amountStr);
    
    if (targetId && !isNaN(amount)) {
      const targetUser = db_helper.getUser(targetId);
      if (targetUser) {
        db_helper.updateBalance(targetId, amount);
        db_helper.updateVideoSetting(userId, 'is_admin_adding_bananas', 0);
        await ctx.reply(`✅ Пользователю ${targetId} начислено ${amount} 🍌.\nНовый баланс: ${targetUser.balance + amount} 🍌`);
      } else {
        await ctx.reply('❌ Пользователь не найден.');
      }
    } else {
      await ctx.reply('❌ Неверный формат. Используйте: ID количество');
    }
    return;
  }

  // Handle Photo=Prompt: Uploading photo for analysis
  if (user.photo_prompt_state === 'awaiting_photo') {
    const attachments = ctx.message.body.attachments || [];
    const images = attachments.filter((a: { type: string }) => a.type === 'image');
    if (images.length > 0) {
      const imageUrl = (images[0] as any).payload.url;

      const prevCount = db_helper.getUser(userId)?.photo_prompt_upload_count ?? 0;
      db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', prevCount + images.length);
      const afterAdd = db_helper.getUser(userId)!;
      const menuMid = afterAdd.photo_prompt_menu_message_id;
      if (menuMid) {
        try {
          await bot.api.editMessage(menuMid, {
            text: getPhotoPromptMenuText(afterAdd),
            attachments: [getPhotoPromptMenuKeyboard()]
          });
        } catch (e) {
          logger.warn('photo_prompt', 'Не удалось обновить карточку меню (счётчик)', e);
        }
      }

      try {
        await ctx.reply('⏳ Анализирую фото... Это может занять несколько секунд.');

        const prompt = await kie_api.analyzeImage(imageUrl);

        db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'idle');
        db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
        db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);

        await ctx.reply(
          `✅ Готово! Вот промпт для генерации похожего фото:\n\n` +
            `\`\`\`\n${prompt}\n\`\`\`\n\n` +
            `💡 Скопируйте промпт и используйте его в разделе "Создать фото" или "Создать видео".`,
          {
            attachments: [
              Keyboard.inlineKeyboard([
                [Keyboard.button.callback('📸 Создать фото', 'photo_menu')],
                [Keyboard.button.callback('🎬 Создать видео', 'video_menu')],
                [Keyboard.button.callback('🏠 В меню', 'main_menu_reply')]
              ])
            ]
          }
        );
      } catch (error) {
        logger.error('photo_prompt', 'Photo analysis error', error);
        db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
        db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);
        await ctx.reply('❌ Ошибка при анализе фото. Попробуйте другое изображение или зайдите позже.');
      }
      return;
    }
  }

  // Handle Photo Step 1: Uploading references
  if (user.photo_state === 'awaiting_refs') {
    const attachments = ctx.message.body.attachments;
    if (attachments && attachments.length > 0) {
      let refs = JSON.parse(user.photo_references || '[]');
      let added = false;
      for (const attachment of attachments) {
        if (attachment.type === 'image' && refs.length < 14) {
          refs.push((attachment as any).payload.url);
          added = true;
        }
      }
      if (added) {
        db_helper.updateVideoSetting(userId, 'photo_references', JSON.stringify(refs));
        const updatedUser = db_helper.getUser(userId)!;
        const menuMid = updatedUser.photo_menu_message_id;
        if (menuMid) {
          try {
            await bot.api.editMessage(menuMid, {
              text: getPhotoMenuText(updatedUser),
              attachments: [getPhotoMenuKeyboard(updatedUser)]
            });
          } catch (e) {
            logger.warn('photo', 'Не удалось обновить карточку меню (референсы)', e);
          }
        }
        return;
      }
    }
  }

  // Handle Photo: промпт в чат на экране «модель + формат»
  if (user.photo_state === 'awaiting_photo_model' && ctx.message.body.text) {
    const prompt = ctx.message.body.text;
    const refs = JSON.parse(user.photo_references || '[]');

    if (prompt.trim().length < 10) {
      await ctx.reply('❌ Промпт слишком короткий (минимум 10 символов).\n\nПожалуйста, опишите подробнее — например: стиль, детали, атмосферу.');
      return;
    }

    const modelId = user.photo_kie_model as PhotoKieModelId | null;
    if (!modelId || !PHOTO_MODEL_META[modelId]) {
      await ctx.reply('❌ Модель не выбрана. Откройте «Создать фото» и пройдите шаги заново.');
      return;
    }

    const prefs = parsePhotoGenPrefs(user);
    const cost = getPhotoGenerationBananaCost(modelId, prefs);
    const meta = PHOTO_MODEL_META[modelId];

    if (user.balance < cost) {
      return ctx.reply(`❌ Недостаточно бананов для генерации (нужно ${cost} 🍌).`);
    }

    if (modelId === 'seedream_45_edit' && refs.length === 0) {
      await ctx.reply(
        '❌ Для Seedream 4.5 нужна минимум одна фотография. Загрузите референсы или выберите другую модель.'
      );
      return;
    }

    try {
      await ctx.reply('⏳ Начинаю генерацию фото... Это может занять несколько минут.');

      const params = await buildPhotoCreateTaskParams(user, prompt, refs);
      const task = await kie_api.createTask({
        model: params.model,
        input: params.input
      });

      if (task.code === 200) {
        const taskId = task.data.taskId;
        db_helper.updateVideoSetting(userId, 'last_task_id', taskId);
        db_helper.logPhotoGeneration(userId, params.model, 'waiting', taskId, prompt);

        db_helper.updateVideoSetting(userId, 'photo_state', 'idle');
        db_helper.updateVideoSetting(userId, 'photo_references', '[]');
        db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
        clearPhotoKieSelection(userId);

        pollPhotoTaskStatus(ctx, taskId, userId, cost);
      } else {
        await ctx.reply(`❌ Сервис генерации фото временно недоступен (${meta.shortLabel}).`);
      }
    } catch (error: any) {
      if (error?.message === 'NO_REFS_FOR_SEEDREAM_EDIT') {
        await ctx.reply('❌ Не удалось подготовить изображения для Seedream 4.5. Добавьте референсы и попробуйте снова.');
        return;
      }
      logger.error('photo_gen', 'Photo generation error', error);
      await ctx.reply(`❌ Ошибка генерации (${meta.shortLabel}). Попробуйте позже.`);
    }
    return;
  }

  // Handle Motion Control Step 1: Uploading photo
  if (user.motion_state === 'awaiting_photo') {
    const attachments = ctx.message.body.attachments;
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.type === 'image') {
          db_helper.updateVideoSetting(
            userId,
            'stored_image_url',
            sanitizeUrl((attachment as any).payload.url)
          );
          db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_video');
          const updatedUser = db_helper.getUser(userId)!;
          await ctx.reply(
            '✅ Фото персонажа получено!\n\n' +
              '📹 Теперь отправьте видео с движением, которое нужно перенести на это фото (референс по движению).',
            {
              attachments: [getMotionControlKeyboard(updatedUser)]
            }
          );
          await ctx.editMessage({
            text: getMotionControlText(updatedUser),
            attachments: [getMotionControlKeyboard(updatedUser)]
          });
          return;
        }
      }
    }
  }

  // Handle Motion Control Step 2: Uploading video
  if (user.motion_state === 'awaiting_video') {
    const attachments = ctx.message.body.attachments;
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.type === 'video') {
          const videoUrl = (attachment as any).payload.url;
          const cost = user.motion_quality === 'std' ? 15 : 30;
          // Standard → Kling 2.6 MC, 720p; Pro → Kling 3.0 MC, 720p (Pro Kling 3.0)
          const internalModel = user.motion_quality === 'std' ? 'kling_2.6_motion' : 'kling_3_motion';
          const modelName =
            user.motion_quality === 'std'
              ? 'Motion Control Standard (Kling 2.6 • 720p)'
              : 'Motion Control Pro (Kling 3.0 • 720p)';

          if (user.balance < cost) {
            return ctx.reply(`❌ Недостаточно бананов для генерации (нужно ${cost} 🍌).`);
          }

          try {
            await ctx.reply(`⏳ Загружаю файлы в облако и запускаю ${modelName}... Это может занять минуту.`);

            const imageUrlKie = await uploadMediaUrlForKie(
              sanitizeUrl(user.stored_image_url!),
              `motion-img-${userId}-${Date.now()}.jpg`
            );
            const videoUrlKie = await uploadMediaUrlForKie(
              sanitizeUrl(videoUrl),
              `motion-vid-${userId}-${Date.now()}.mp4`
            );

            const kieModel = kie_api.mapModel(internalModel);
            const input: any = {
              input_urls: [imageUrlKie],
              video_urls: [videoUrlKie],
              prompt: ''
            };
            if (internalModel === 'kling_3_motion') {
              // https://docs.kie.ai/market/kling/motion-control-v3
              input.mode = '720p';
              input.character_orientation = 'video';
              input.background_source = 'input_video';
            } else {
              // https://docs.kie.ai/market/kling/motion-control — Standard tier: 720p
              input.mode = '720p';
              input.character_orientation = 'video';
            }

            const task = await kie_api.createTask({
              model: kieModel,
              input: input
            });

            if (task.code === 200) {
              const taskId = task.data.taskId;
              db_helper.updateVideoSetting(userId, 'last_task_id', taskId);
              db_helper.logGeneration(userId, internalModel, 'waiting', taskId, '[motion-control]');
              
              // Reset motion state
              db_helper.updateVideoSetting(userId, 'motion_state', 'idle');
              db_helper.updateVideoSetting(userId, 'stored_image_url', null);
              
              // Start polling
              pollTaskStatus(ctx, taskId, userId, internalModel, cost);
            } else {
              logger.error('motion_gen', `Motion createTask failed: ${task.msg}`, task);
              await ctx.reply(`❌ В данный момент сервис "${modelName}" не работает`);
            }
          } catch (error) {
            logger.error('motion_gen', 'Motion generation error', error);
            await ctx.reply(`❌ В данный момент сервис "${modelName}" не работает`);
          }
          return;
        }
      }
    }
  }

  // Handle AI Avatar Pro Step 1: Photo
  if (user.motion_state === 'awaiting_avatar_photo') {
    const attachments = ctx.message.body.attachments;
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.type === 'image') {
          db_helper.updateVideoSetting(userId, 'stored_image_url', sanitizeUrl((attachment as any).payload.url));
          db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_avatar_audio');
          const updatedUser = db_helper.getUser(userId)!;
          await ctx.reply(
            '✅ Фото получено!\n\n' +
              '🎤 Отправьте аудио или голосовое сообщение — бот примет его и использует для AI Avatar Pro.\n' +
              'После аудио нужно будет написать промпт в чат — тогда запустится генерация.',
            {
              attachments: [getMotionControlKeyboard(updatedUser)]
            }
          );
          await ctx.editMessage({
            text: getMotionControlText(updatedUser),
            attachments: [getMotionControlKeyboard(updatedUser)]
          });
          return;
        }
      }
    }
    return;
  }

  // Handle AI Avatar Pro Step 2: Audio only (no video — API expects audio_url)
  if (user.motion_state === 'awaiting_avatar_audio') {
    const attachments = ctx.message.body.attachments;
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        const audioUrl = extractKieAudioAttachmentUrl(attachment as any);
        if (audioUrl) {
          db_helper.updateVideoSetting(userId, 'stored_video_url', audioUrl);
          db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_avatar_prompt');
          const updatedUser = db_helper.getUser(userId)!;
          await ctx.reply('✅ Аудио получено! Теперь введите промпт.', {
            attachments: [getMotionControlKeyboard(updatedUser)]
          });
          await ctx.editMessage({
            text: getMotionControlText(updatedUser),
            attachments: [getMotionControlKeyboard(updatedUser)]
          });
          return;
        }
      }
    }
    return ctx.reply('❌ Нужен только аудиофайл: аудио .mp3');
  }

  // Handle AI Avatar Pro Step 3: Prompt → generate
  if (user.motion_state === 'awaiting_avatar_prompt' && ctx.message.body.text) {
    await runAvatarProGeneration(ctx, userId, ctx.message.body.text);
    return;
  }

  // Handle InfiniTalk from-audio Step 1: Photo
  if (user.motion_state === 'awaiting_infinitalk_photo') {
    const attachments = ctx.message.body.attachments;
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.type === 'image') {
          db_helper.updateVideoSetting(userId, 'stored_image_url', sanitizeUrl((attachment as any).payload.url));
          db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_infinitalk_audio');
          const updatedUser = db_helper.getUser(userId)!;
          await ctx.reply(
            '✅ Фото получено!\n\n' +
              '🎤 Отправьте аудио или голосовое — бот примет файл и передаст его в InfiniTalk (звук для анимации лица).\n' +
              'Дальше напишите промпт в чат — после этого пойдёт генерация видео.',
            {
              attachments: [getMotionControlKeyboard(updatedUser)]
            }
          );
          await ctx.editMessage({
            text: getMotionControlText(updatedUser),
            attachments: [getMotionControlKeyboard(updatedUser)]
          });
          return;
        }
      }
    }
    return;
  }

  // Handle InfiniTalk from-audio Step 2: Audio only (API: audio_url after upload, not video)
  if (user.motion_state === 'awaiting_infinitalk_audio') {
    const attachments = ctx.message.body.attachments;
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        const audioUrl = extractKieAudioAttachmentUrl(attachment as any);
        if (audioUrl) {
          db_helper.updateVideoSetting(userId, 'stored_video_url', audioUrl);
          db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_infinitalk_prompt');
          const updatedUser = db_helper.getUser(userId)!;
          await ctx.reply('✅ Аудио получено! Теперь введите промпт.', {
            attachments: [getMotionControlKeyboard(updatedUser)]
          });
          await ctx.editMessage({
            text: getMotionControlText(updatedUser),
            attachments: [getMotionControlKeyboard(updatedUser)]
          });
          return;
        }
      }
    }
    return ctx.reply(
      '❌ Нужен только аудиофайл (голосовое, аудио или документ .mp3 / .wav / .m4a …).\n\n' +
        'Видео не подходит для infinitalk/from-audio.\n' +
        'https://docs.kie.ai/market/infinitalk/from-audio'
    );
  }

  // Handle InfiniTalk from-audio Step 3: Prompt → generate
  if (user.motion_state === 'awaiting_infinitalk_prompt' && ctx.message.body.text) {
    await runInfiniTalkGeneration(ctx, userId, ctx.message.body.text);
    return;
  }

  // Handle incoming media (photos/videos) for VIDEO section
  if (user.is_awaiting_prompt === 1) {
    const attachments = ctx.message.body.attachments;
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.type === 'image') {
          const rawUrl = (attachment as any).payload.url;
          db_helper.updateVideoSetting(userId, 'stored_image_url', sanitizeUrl(rawUrl));
          const isHailuoModel = user.video_model === 'hailuo_2.3';
          const isGrokModel = user.video_model === 'grok_img2video';
          const photoReplyText = isHailuoModel
            ? '✅ Фото получено! Теперь напишите в чат — что должно происходить в видео.\n\nНапример: "плавно поворачивает голову", "танцует", "подмигивает"'
            : isGrokModel
              ? '✅ Фото получено! Теперь напишите промпт — опишите движение и атмосферу сцены (минимум 10 символов).'
              : '✅ Фото получено! Теперь отправьте текстовый промпт для начала генерации.';
          await ctx.reply(photoReplyText);
          return;
        } else if (attachment.type === 'video' || attachment.type === 'audio') {
          const rawUrl = (attachment as any).payload.url;
          db_helper.updateVideoSetting(userId, 'stored_video_url', sanitizeUrl(rawUrl));
          const typeLabel = attachment.type === 'video' ? 'Видео' : 'Аудио';
          await ctx.reply(`✅ ${typeLabel} получено! Если это всё, отправьте текстовый промпт для начала генерации.`);
          return;
        }
      }
    }
  }
  
  // Handle text prompt for video generation
  if (user.is_awaiting_prompt === 1 && ctx.message.body.text) {
    const prompt = ctx.message.body.text;

    if (prompt.trim().length < 10) {
      await ctx.reply('❌ Промпт слишком короткий (минимум 10 символов).\n\nПожалуйста, опишите подробнее — например: стиль, движение, атмосферу сцены.');
      return;
    }

    // Check if required media is present
    const isMotion = user.video_model.includes('motion');
    const isPhotoToVideo = user.video_mode === 'photo_to_video';
    const isVideoToVideo = user.video_mode === 'video_to_video';
    const isHailuo = user.video_model === 'hailuo_2.3';
    const isGrok = user.video_model === 'grok_img2video';
    if ((isPhotoToVideo || isMotion) && !user.stored_image_url) {
      return ctx.reply('❌ Сначала загрузите фото (отправьте его в чат).');
    }
    if ((isVideoToVideo || isMotion) && !user.stored_video_url) {
      return ctx.reply('❌ Сначала загрузите видео (отправьте его в чат).');
    }
    // Hailuo — image-to-video, image is required
    if (isHailuo && !user.stored_image_url) {
      return ctx.reply('❌ Хайлуо 2.3 требует фото. Сначала загрузите изображение (отправьте его в чат).');
    }
    // Grok — image-to-video, image is required
    if (isGrok && !user.stored_image_url) {
      return ctx.reply('❌ Grok Img→Video требует фото. Сначала загрузите изображение (отправьте его в чат).');
    }

    // Reset awaiting status and stored media after task creation
    db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 0);

    const videoCost = getVideoCost(user.video_model, user.video_duration);
    if (user.balance < videoCost) {
      return ctx.reply(`❌ Недостаточно бананов для генерации (нужно ${videoCost} 🍌).`);
    }

    try {
      await ctx.reply('⏳ Начинаю генерацию видео... Это может занять несколько минут.');
      
      const kieModel = kie_api.mapModel(user.video_model);
      const input: any = {
        prompt: prompt
      };

      // Set mode/resolution based on model type
      if (kieModel.includes('hailuo')) {
        input.resolution = user.video_duration === '10 сек' ? '768P' : '1080P';
      } else if (kieModel.includes('seedance') && kieModel !== 'bytedance/seedance-2') {
        input.resolution = '720p';
      }

      // Add duration if supported and selected
      if (user.video_duration) {
        const durationValue = user.video_duration.split(' ')[0];
        if (kieModel === 'bytedance/seedance-2') {
          const n = parseInt(durationValue, 10);
          input.duration = [4, 8, 12].includes(n) ? n : 8;
        } else if (kieModel.includes('seedance')) {
          // Seedance 1.5: строка
          const validDurations = ['4', '8', '12'];
          input.duration = validDurations.includes(durationValue) ? durationValue : '8';
        } else if (kieModel.includes('hailuo')) {
          // Hailuo supports: '6', '10' as strings. Default to '6' if invalid.
          input.duration = ['6', '10'].includes(durationValue) ? durationValue : '6';
        } else if (kieModel.includes('kling-3.0')) {
          input.duration = durationValue;
        }
      }

      // Add aspect ratio if supported
      if (user.video_ratio) {
        if (kieModel === 'bytedance/seedance-2') {
          const validRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'];
          input.aspect_ratio = validRatios.includes(user.video_ratio) ? user.video_ratio : '16:9';
        } else if (kieModel.includes('seedance')) {
          const validRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'];
          input.aspect_ratio = validRatios.includes(user.video_ratio) ? user.video_ratio : '1:1';
        } else if (kieModel.includes('kling-3.0')) {
          // Kling supports: 16:9, 9:16, 1:1
          const validRatios = ['16:9', '9:16', '1:1'];
          input.aspect_ratio = validRatios.includes(user.video_ratio) ? user.video_ratio : '16:9';
        } else if (kieModel.includes('veo3')) {
          // Veo supports: 16:9, 9:16, Auto
          const validRatios = ['16:9', '9:16', 'Auto'];
          input.aspect_ratio = validRatios.includes(user.video_ratio) ? user.video_ratio : '16:9';
        }
      }

      if (kieModel === 'kling-3.0/video') {
        input.multi_shots = false;
        input.sound = false;
        input.multi_prompt = []; 
        input.mode = user.video_model.includes('pro') ? 'pro' : 'std';
        if (user.stored_image_url) {
          input.image_urls = [user.stored_image_url];
        }
      } else if (kieModel.includes('kling') && kieModel.includes('motion-control')) {
        input.character_orientation = 'video';
        if (user.video_model === 'kling_3_motion') {
          input.mode = '720p';
          input.background_source = 'input_video';
        } else {
          input.mode = '720p';
        }
      } else if (kieModel.includes('veo3')) {
        if (user.stored_image_url) {
          input.imageUrls = [user.stored_image_url];
          input.generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
        } else {
          input.generationType = 'TEXT_2_VIDEO';
        }
      } else if (kieModel === 'bytedance/seedance-2') {
        const vp = parseVideoGenPrefs(user);
        input.resolution = '720p';
        input.generate_audio = vp.seedance2_generate_audio;
        input.return_last_frame = false;
        input.web_search = true;

        if (user.video_mode === 'photo_to_video' && user.stored_image_url) {
          const first = await uploadMediaUrlForKie(
            sanitizeUrl(user.stored_image_url),
            `seed2-first-${userId}-${Date.now()}.jpg`
          );
          input.first_frame_url = first;
        } else if (user.video_mode === 'video_to_video' && user.stored_video_url) {
          const refVid = await uploadMediaUrlForKie(
            sanitizeUrl(user.stored_video_url),
            `seed2-refvid-${userId}-${Date.now()}.mp4`
          );
          input.reference_video_urls = [refVid];
        }
      } else if (kieModel.includes('seedance')) {
        if (user.stored_image_url) {
          input.input_urls = [user.stored_image_url];
        }
      } else if (kieModel.includes('hailuo')) {
        if (user.stored_image_url) {
          input.image_url = user.stored_image_url;
        }
      } else if (kieModel.includes('grok-imagine')) {
        // Grok: always requires image, upload to Kie CDN first
        const grokImg = await uploadMediaUrlForKie(
          sanitizeUrl(user.stored_image_url!),
          `grok-img-${userId}-${Date.now()}.jpg`
        );
        input.image_urls = [grokImg];
        input.mode = user.grok_mode || 'normal';
        const grokDurationSec = parseInt(user.video_duration) || 10;
        input.duration = String(Math.min(30, Math.max(6, grokDurationSec)));
        input.resolution = '720p';
        const grokValidRatios = ['2:3', '3:2', '1:1', '16:9', '9:16'];
        input.aspect_ratio = grokValidRatios.includes(user.video_ratio) ? user.video_ratio : '16:9';
      }

      if (kieModel.includes('kling') && kieModel.includes('motion-control')) {
        const imgK = await uploadMediaUrlForKie(
          sanitizeUrl(user.stored_image_url!),
          `video-motion-img-${userId}-${Date.now()}.jpg`
        );
        const vidK = await uploadMediaUrlForKie(
          sanitizeUrl(user.stored_video_url!),
          `video-motion-vid-${userId}-${Date.now()}.mp4`
        );
        input.input_urls = [imgK];
        input.video_urls = [vidK];
      }

      logger.info('video_gen', 'Video task payload', { model: kieModel, input });

      const task = await kie_api.createTask({
        model: kieModel,
        input: input
      });

      if (task.code === 200) {
        const taskId = task.data.taskId;
        db_helper.updateVideoSetting(userId, 'last_task_id', taskId);
        db_helper.logGeneration(userId, user.video_model, 'waiting', taskId, prompt);
        // Clear stored media for next task
        db_helper.updateVideoSetting(userId, 'stored_image_url', null);
        db_helper.updateVideoSetting(userId, 'stored_video_url', null);
        // Start polling in background
        pollTaskStatus(ctx, taskId, userId, user.video_model, videoCost);
      } else {
        logger.error('video_gen', 'API returned non-200', task);
        const modelName = modelMap[user.video_model] || user.video_model;
        await ctx.reply(`❌ В данный момент сервис "${modelName}" не работает`);
      }
    } catch (error: any) {
      logger.error('video_gen', 'Task creation error', error?.response?.data || error?.message);
      const modelName = modelMap[user.video_model] || user.video_model;
      await ctx.reply(`❌ В данный момент сервис "${modelName}" не работает`);
    }
    return;
  }

  return next();
});

const CHANNEL_MAX_URL = 'https://max.ru/id250207076892_biz';
const SUPPORT_MAX_URL =
  'https://max.ru/u/f9LHodD0cOIAsgezIv4h-Ee9McfyQl4NVTYjslluD4yZg2sE-EVVrbTbzIg';

/** Формат текста главного меню (ссылка «Канал» в markdown) */
const MAIN_MENU_FORMAT = 'markdown' as const;

// Main menu text template
const getMainMenuText = (balance: number) => `
🏠 Главное меню

Хватит просто смотреть — создавай с AI! 🔥

✅ Генерация артов: Пиши промпт — получай шедевр.
✅ Фото-магия: Стилизация и замена объектов в пару кликов.
✅ Видео-продакшн: Делаю ролики из слов и фото.
✅ FX-эффекты: Твои видео станут выглядеть на миллион.

🍌 Ваш баланс: ${balance} бананов

⚠️ Неприемлемый контент (насилие, сексуальный или детский контент и т.п.) запрещён: такие запросы **не проходят** в генерацию. При выявлении нарушения ваш аккаунт будет **заблокирован без возврата средств**.

📢 Наш [Канал](${CHANNEL_MAX_URL})

Попробуй прямо сейчас! 👇
`;

// Main menu keyboard
const getMainMenuKeyboard = () => {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('Создать видео', 'create_video'),
      Keyboard.button.callback('Motion Control', 'motion_control')
    ],
    [
      Keyboard.button.callback('Создать фото', 'create_photo'),
      Keyboard.button.callback('Фото=промт', 'photo_prompt')
    ],
    [
      Keyboard.button.callback('Пополнить', 'top_up'),
      Keyboard.button.link('Тех поддержка', SUPPORT_MAX_URL)
    ]
  ]);
};

// ─── Shared generation helpers for Avatar Pro & InfiniTalk ───────────────────

const motionAudioBananaCost = (durationSec: number): number =>
  Math.max(1, Math.ceil(durationSec)) * 10;

const runAvatarProGeneration = async (ctx: any, userId: string, prompt: string) => {
  const user = db_helper.getUser(userId);
  if (!user) return;

  if (!user.stored_image_url || !user.stored_video_url) {
    return ctx.reply('❌ Не найдены загруженные файлы. Начните заново — нажмите «AI Avatar Pro» в меню Motion Control.');
  }

  const audioUrl = sanitizeUrl(user.stored_video_url);
  const durationSec = await tryDurationFromMediaUrl(audioUrl);
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) {
    return ctx.reply(
      '❌ Не удалось определить длительность аудио. На сервере бота нужен FFmpeg/ffprobe в PATH. Попробуйте другой файл или формат.'
    );
  }
  const cost = motionAudioBananaCost(durationSec);
  if (user.balance < cost) {
    return ctx.reply(
      `❌ Недостаточно бананов: нужно ${cost} 🍌 (≈ ${durationSec.toFixed(1)} с × 10 🍌/сек).`
    );
  }

  try {
    await ctx.reply('⏳ Загружаю фото и аудио в облако, затем запускаю AI Avatar Pro...');

    const imageKie = await uploadMediaUrlForKie(user.stored_image_url!, `avatar-img-${userId}-${Date.now()}.jpg`);
    const audioKie = await uploadMediaUrlForKie(audioUrl, `avatar-aud-${userId}-${Date.now()}.m4a`);

    const kieModel = kie_api.mapModel('ai_avatar_pro');
    const input = { image_url: imageKie, audio_url: audioKie, prompt };

    logger.info('avatar_gen', 'Avatar task payload', { model: kieModel, input, cost, durationSec });

    const task = await kie_api.createTask({ model: kieModel, input });

    if (task.code === 200) {
      db_helper.updateVideoSetting(userId, 'last_task_id', task.data.taskId);
      db_helper.logGeneration(userId, 'ai_avatar_pro', 'waiting', task.data.taskId, prompt || '[no prompt]');
      db_helper.updateVideoSetting(userId, 'motion_state', 'idle');
      db_helper.updateVideoSetting(userId, 'stored_image_url', null);
      db_helper.updateVideoSetting(userId, 'stored_video_url', null);
      pollTaskStatus(ctx, task.data.taskId, userId, 'ai_avatar_pro', cost);
    } else {
      await ctx.reply('❌ В данный момент сервис "AI Avatar Pro" не работает');
    }
  } catch (error) {
    logger.error('avatar_gen', 'Avatar generation error', error);
    await ctx.reply('❌ В данный момент сервис "AI Avatar Pro" не работает');
  }
};

const runInfiniTalkGeneration = async (ctx: any, userId: string, prompt: string) => {
  const user = db_helper.getUser(userId);
  if (!user) return;

  if (!user.stored_image_url || !user.stored_video_url) {
    return ctx.reply('❌ Не найдены загруженные файлы. Начните заново — нажмите «InfiniTalk» в меню Motion Control.');
  }

  const audioUrl = sanitizeUrl(user.stored_video_url);
  const durationSec = await tryDurationFromMediaUrl(audioUrl);
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) {
    return ctx.reply(
      '❌ Не удалось определить длительность аудио. На сервере бота нужен FFmpeg/ffprobe в PATH. Попробуйте другой файл или формат.'
    );
  }
  const cost = motionAudioBananaCost(durationSec);
  if (user.balance < cost) {
    return ctx.reply(
      `❌ Недостаточно бананов: нужно ${cost} 🍌 (≈ ${durationSec.toFixed(1)} с × 10 🍌/сек).`
    );
  }

  try {
    await ctx.reply('⏳ Загружаю фото и аудио в облако, затем запускаю InfiniTalk...');

    const imageKie = await uploadMediaUrlForKie(user.stored_image_url!, `infinitalk-img-${userId}-${Date.now()}.jpg`);
    const audioKie = await uploadMediaUrlForKie(audioUrl, `infinitalk-aud-${userId}-${Date.now()}.m4a`);

    const kieModel = kie_api.mapModel('from_audio');
    const seed = Math.floor(10000 + Math.random() * 990000);
    const input = { image_url: imageKie, audio_url: audioKie, prompt, resolution: '720p', seed };

    logger.info('infinitalk_gen', 'InfiniTalk task payload', { model: kieModel, input, cost, durationSec });

    const task = await kie_api.createTask({ model: kieModel, input });

    if (task.code === 200) {
      db_helper.updateVideoSetting(userId, 'last_task_id', task.data.taskId);
      db_helper.logGeneration(userId, 'from_audio', 'waiting', task.data.taskId, prompt || '[no prompt]');
      db_helper.updateVideoSetting(userId, 'motion_state', 'idle');
      db_helper.updateVideoSetting(userId, 'stored_image_url', null);
      db_helper.updateVideoSetting(userId, 'stored_video_url', null);
      pollTaskStatus(ctx, task.data.taskId, userId, 'from_audio', cost);
    } else {
      await ctx.reply('❌ В данный момент сервис "InfiniTalk" не работает');
    }
  } catch (error) {
    logger.error('infinitalk_gen', 'InfiniTalk generation error', error);
    await ctx.reply('❌ В данный момент сервис "InfiniTalk" не работает');
  }
};

bot.action('skip_model_prompt', async (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const user = db_helper.getUser(userId);
  if (!user) return;

  if (user.motion_state === 'awaiting_avatar_prompt') {
    await runAvatarProGeneration(ctx, userId, '');
  } else if (user.motion_state === 'awaiting_infinitalk_prompt') {
    await runInfiniTalkGeneration(ctx, userId, '');
  }
});

// Start command / Welcome message
bot.command('start', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  let user = db_helper.getUser(userId);

  if (!user) {
    user = db_helper.createUser(userId, 10);
  } else {
    // Reset all input states so the user starts fresh
    db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 0);
    db_helper.updateVideoSetting(userId, 'photo_state', 'idle');
    db_helper.updateVideoSetting(userId, 'photo_references', '[]');
    db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'idle');
    db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
    db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);
    db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
    clearPhotoKieSelection(userId);
    db_helper.updateVideoSetting(userId, 'motion_state', 'idle');
    db_helper.updateVideoSetting(userId, 'is_admin_adding_bananas', 0);
    db_helper.updateVideoSetting(userId, 'is_admin_broadcasting', 0);
    user = db_helper.getUser(userId)!;
  }

  return ctx.reply(getMainMenuText(user.balance), {
    format: MAIN_MENU_FORMAT,
    attachments: [getMainMenuKeyboard()]
  });
});

/** Тест длительности видео: затем одним сообщением отправьте видео в этот же чат */
bot.command('probe_video', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  if (!db_helper.getUser(userId)) {
    return ctx.reply('Сначала отправьте /start');
  }
  videoProbePendingUserIds.add(userId);
  return ctx.reply(
    '📹 Режим проверки.\n\n' +
      'Следующим сообщением отправьте видео в этот чат с ботом.\n' +
      'Бот ответит: удалось ли узнать длительность (поле вложения или ffprobe) и какие поля пришли.\n\n' +
      'Для ffprobe на сервере должен быть установлен FFmpeg.\n' +
      'Повторить ожидание: /probe_video снова.'
  );
});

// bot_started event (usually when a user opens the bot)
bot.on('bot_started', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  let user = db_helper.getUser(userId);

  if (!user) {
    user = db_helper.createUser(userId, 10);
  }

  return ctx.reply(getMainMenuText(user.balance), {
    format: MAIN_MENU_FORMAT,
    attachments: [getMainMenuKeyboard()]
  });
});

// --- PHOTO HANDLERS ---
bot.action('create_photo', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  
  // Set initial photo state and reset video section state
  db_helper.updateVideoSetting(userId, 'photo_state', 'awaiting_refs');
  db_helper.updateVideoSetting(userId, 'photo_references', '[]');
  db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);
  db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
  clearPhotoKieSelection(userId);

  const user = db_helper.getUser(userId)!;

  persistPhotoMenuMessageId(ctx, userId);
  return ctx.editMessage({
    text: getPhotoMenuText(user),
    attachments: [getPhotoMenuKeyboard(user)]
  });
});

bot.action('photo_skip_refs', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);

  db_helper.updateVideoSetting(userId, 'photo_state', 'awaiting_photo_model');
  primePhotoConfigureStep(userId);
  const user = db_helper.getUser(userId)!;

  persistPhotoMenuMessageId(ctx, userId);
  return ctx.editMessage({
    text: getPhotoMenuText(user),
    attachments: [getPhotoMenuKeyboard(user)]
  });
});

bot.action('photo_continue_to_prompt', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);

  db_helper.updateVideoSetting(userId, 'photo_state', 'awaiting_photo_model');
  primePhotoConfigureStep(userId);
  const user = db_helper.getUser(userId)!;

  persistPhotoMenuMessageId(ctx, userId);
  return ctx.editMessage({
    text: getPhotoMenuText(user),
    attachments: [getPhotoMenuKeyboard(user)]
  });
});

bot.action(/^photo_pick_(s5|s45|nbp|nb2)$/, (ctx) => {
  if (!ctx.user || !ctx.match) return;
  const userId = maxCtxUserId(ctx);
  const suf = ctx.match[1];
  const modelId = PHOTO_CALLBACK_TO_MODEL[suf];
  if (!modelId) return;

  const refs = JSON.parse(db_helper.getUser(userId)?.photo_references || '[]');
  if (modelId === 'seedream_45_edit' && refs.length === 0) {
    return ctx.answerOnCallback({
      notification: 'Seedream 4.5: загрузите минимум 1 фото на шаге 1'
    });
  }

  db_helper.updateVideoSetting(userId, 'photo_kie_model', modelId);
  persistPhotoMenuMessageId(ctx, userId);
  const user = db_helper.getUser(userId)!;
  return ctx.editMessage({
    text: getPhotoMenuText(user),
    attachments: [getPhotoMenuKeyboard(user)]
  });
});

bot.action('photo_back_to_refs', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  clearPhotoKieSelection(userId);
  db_helper.updateVideoSetting(userId, 'photo_state', 'awaiting_refs');
  persistPhotoMenuMessageId(ctx, userId);
  const user = db_helper.getUser(userId)!;
  return ctx.editMessage({
    text: getPhotoMenuText(user),
    attachments: [getPhotoMenuKeyboard(user)]
  });
});

for (const payload of PHOTO_AR_CALLBACK_PAYLOADS) {
  bot.action(payload, async (ctx) => {
    if (!ctx.user) return;
    const userId = maxCtxUserId(ctx);
    const u = db_helper.getUser(userId);
    if (!u || u.photo_state !== 'awaiting_photo_model') return;
    const ar = photoCallbackToAspectRatio(payload);
    if (!ar) return;
    patchPhotoGenPrefs(userId, { aspect_ratio: ar });
    return refreshPhotoFlowCard(ctx, userId);
  });
}

bot.action('photo_qual_2k', async (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const u = db_helper.getUser(userId);
  if (!u || u.photo_state !== 'awaiting_photo_model') return;
  patchPhotoGenPrefs(userId, { output_quality: '2k' });
  return refreshPhotoFlowCard(ctx, userId);
});

bot.action('photo_qual_4k', async (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const u = db_helper.getUser(userId);
  if (!u || u.photo_state !== 'awaiting_photo_model') return;
  patchPhotoGenPrefs(userId, { output_quality: '4k' });
  return refreshPhotoFlowCard(ctx, userId);
});

// --- MOTION CONTROL HANDLERS ---
bot.action('motion_control', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const user = db_helper.getUser(userId);
  if (!user) return;

  // Reset state
  db_helper.updateVideoSetting(userId, 'motion_state', 'idle');
  db_helper.updateVideoSetting(userId, 'stored_image_url', null);
  db_helper.updateVideoSetting(userId, 'stored_video_url', null);
  db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);
  db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
  clearPhotoKieSelection(userId);

  return ctx.editMessage({
    text: getMotionControlText(user),
    attachments: [getMotionControlKeyboard(user)]
  });
});

bot.action('set_motion_std', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'motion_quality', 'std');
  db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_photo');
  const user = db_helper.getUser(userId)!;

  return ctx.editMessage({
    text: getMotionControlText(user),
    attachments: [getMotionControlKeyboard(user)]
  });
});

bot.action('set_motion_pro', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'motion_quality', 'pro');
  db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_photo');
  const user = db_helper.getUser(userId)!;

  return ctx.editMessage({
    text: getMotionControlText(user),
    attachments: [getMotionControlKeyboard(user)]
  });
});

bot.action('set_avatar', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_avatar_photo');
  db_helper.updateVideoSetting(userId, 'stored_image_url', null);
  db_helper.updateVideoSetting(userId, 'stored_video_url', null);
  db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 0);
  db_helper.updateVideoSetting(userId, 'photo_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
  clearPhotoKieSelection(userId);
  const user = db_helper.getUser(userId)!;

  return ctx.editMessage({
    text: getMotionControlText(user),
    attachments: [getMotionControlKeyboard(user)]
  });
});

bot.action('set_infinitalk', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'motion_state', 'awaiting_infinitalk_photo');
  db_helper.updateVideoSetting(userId, 'stored_image_url', null);
  db_helper.updateVideoSetting(userId, 'stored_video_url', null);
  db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 0);
  db_helper.updateVideoSetting(userId, 'photo_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
  clearPhotoKieSelection(userId);
  const user = db_helper.getUser(userId)!;

  return ctx.editMessage({
    text: getMotionControlText(user),
    attachments: [getMotionControlKeyboard(user)]
  });
});

bot.action('motion_control_reset', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'motion_state', 'idle');
  db_helper.updateVideoSetting(userId, 'stored_image_url', null);
  const user = db_helper.getUser(userId)!;

  return ctx.editMessage({
    text: getMotionControlText(user),
    attachments: [getMotionControlKeyboard(user)]
  });
});

// --- ADMIN HANDLERS ---
bot.command('admin', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  
  if (!isAdmin(userId)) {
    return ctx.reply('❌ У вас нет прав доступа к этой команде.');
  }

  return ctx.reply(getAdminPanelText(), {
    attachments: [getAdminPanelKeyboard()]
  });
});

bot.command(/^logs(\s+\w+)?$/, async (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);

  if (!isAdmin(userId)) {
    return ctx.reply('❌ У вас нет прав доступа к этой команде.');
  }

  // ctx.match[1] contains the subcommand if present (e.g. " error", " clear")
  const subCmd = ctx.match?.[1]?.trim().toLowerCase() || '';

  if (subCmd === 'clear') {
    db_helper.clearLogs();
    return ctx.reply('🗑 Логи очищены.');
  }

  const level = ['error', 'warn', 'info'].includes(subCmd) ? subCmd : undefined;
  const entries = db_helper.getLogs(25, level);

  if (!entries.length) {
    return ctx.reply('📋 Логов нет' + (level ? ` уровня ${level}` : '') + '.');
  }

  const ICONS: Record<string, string> = { error: '🔴', warn: '🟡', info: '🔵' };

  const lines = entries.map(e => {
    const ts = e.created_at.slice(0, 19).replace('T', ' ');
    const icon = ICONS[e.level] ?? '⚪';
    const det = e.details ? `\n    ↳ ${e.details.slice(0, 200)}` : '';
    const user = e.user_id ? ` [u:${e.user_id}]` : '';
    return `${icon} ${ts} [${e.type}]${user}\n    ${e.message}${det}`;
  });

  const header = `📋 Последние логи${level ? ` (${level})` : ''} — ${entries.length} записей:\n\n`;
  const body = lines.join('\n\n');
  const footer = '\n\n/logs error — только ошибки\n/logs warn — предупреждения\n/logs info — инфо\n/logs clear — очистить';

  // Max message length is ~4096, split if needed
  const full = header + body + footer;
  if (full.length <= 4000) {
    return ctx.reply(full);
  }
  // Send truncated
  return ctx.reply(header + lines.slice(0, 10).join('\n\n') + '\n\n⚠️ Показаны последние 10 из ' + entries.length + footer);
});

bot.command('ban', async (ctx) => {
  if (!ctx.user || !ctx.message) return;
  const adminId = (ctx.user as any).user_id?.toString();
  if (!adminId || !isAdmin(adminId)) return ctx.reply('❌ Нет прав.');

  const targetId = ctx.message.body.text?.replace(/^\/ban\s*/, '').trim();
  if (!targetId) return ctx.reply('❌ Укажите ID пользователя: /ban <user_id>');

  const target = db_helper.getUser(targetId);
  if (!target) return ctx.reply(`❌ Пользователь ${targetId} не найден.`);
  if (target.is_banned === 1) return ctx.reply(`⚠️ Пользователь ${targetId} уже заблокирован.`);

  db_helper.banUser(targetId);
  logger.info('admin', `User banned by admin ${adminId}`, targetId);
  return ctx.reply(`✅ Пользователь ${targetId} заблокирован.`);
});

bot.command('unban', async (ctx) => {
  if (!ctx.user || !ctx.message) return;
  const adminId = (ctx.user as any).user_id?.toString();
  if (!adminId || !isAdmin(adminId)) return ctx.reply('❌ Нет прав.');

  const targetId = (ctx.message as any).body.text?.replace(/^\/unban\s*/, '').trim();
  if (!targetId) return ctx.reply('❌ Укажите ID пользователя: /unban <user_id>');

  const target = db_helper.getUser(targetId);
  if (!target) return ctx.reply(`❌ Пользователь ${targetId} не найден.`);
  if (target.is_banned === 0) return ctx.reply(`⚠️ Пользователь ${targetId} не заблокирован.`);

  db_helper.unbanUser(targetId);
  logger.info('admin', `User unbanned by admin ${adminId}`, targetId);
  return ctx.reply(`✅ Пользователь ${targetId} разблокирован.`);
});

bot.action('admin_refresh_stats', (ctx) => {
  if (!ctx.user || !isAdmin(maxCtxUserId(ctx))) return;
  
  return ctx.editMessage({
    text: getAdminPanelText(),
    attachments: [getAdminPanelKeyboard()]
  });
});

bot.action('admin_users_excel', async (ctx) => {
  if (!ctx.user || !isAdmin(maxCtxUserId(ctx))) return;

  try {
    await ctx.reply('⏳ Формирую таблицу пользователей...');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BananaBot';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Пользователи');

    sheet.columns = [
      { header: 'ID пользователя',    key: 'id',            width: 22 },
      { header: 'Баланс 🍌',          key: 'balance',       width: 12 },
      { header: 'Видео генераций',     key: 'video_total',   width: 16 },
      { header: 'Видео успешных',      key: 'video_success', width: 16 },
      { header: 'Фото генераций',      key: 'photo_total',   width: 16 },
      { header: 'Фото успешных',       key: 'photo_success', width: 16 },
      { header: 'Дата регистрации',    key: 'created_at',    width: 22 },
    ];

    // Header row styling
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 20;

    const users = db_helper.getAllUsersWithStats();
    users.forEach((u, idx) => {
      const row = sheet.addRow({
        id:            u.id,
        balance:       u.balance,
        video_total:   u.video_total,
        video_success: u.video_success,
        photo_total:   u.photo_total,
        photo_success: u.photo_success,
        created_at:    u.created_at,
      });
      // Alternating row colors
      if (idx % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F7FF' } };
      }
    });

    // Auto-filter on header
    sheet.autoFilter = { from: 'A1', to: 'G1' };

    // Summary row at the bottom
    const lastRow = users.length + 3;
    sheet.getCell(`A${lastRow}`).value = 'Итого пользователей:';
    sheet.getCell(`A${lastRow}`).font = { bold: true };
    sheet.getCell(`B${lastRow}`).value = users.length;
    sheet.getCell(`B${lastRow}`).font = { bold: true };

    const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `users_${dateStamp}.xlsx`;

    const excelBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    // Get upload URL from Max Bot API
    const uploadInfo = await (bot.api as any).raw.uploads.getUploadUrl({ type: 'file' });

    // Force multipart upload so the server returns a proper media token
    const formData = new FormData();
    formData.append('data', new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), fileName);
    const uploadRes = await fetch(uploadInfo.url, { method: 'POST', body: formData });
    const uploadResult = await uploadRes.json() as any;

    // Token may come from the upload result or (for range-upload URLs) from uploadInfo
    const mediaToken: string = uploadResult?.token ?? uploadInfo?.token;
    if (!mediaToken) throw new Error('No media token received from upload');

    const fileAttach = new FileAttachment({ token: mediaToken });
    await ctx.reply(`📋 Таблица пользователей\n🕐 ${now} МСК\n👥 Всего: ${users.length}`, {
      attachments: [
        fileAttach.toJson(),
        Keyboard.inlineKeyboard([[Keyboard.button.callback('⬅️ Назад', 'admin_refresh_stats')]])
      ]
    });
  } catch (error) {
    logger.error('admin', 'Excel export error', error);
    await ctx.reply('❌ Ошибка при создании таблицы.');
  }
});

bot.action('admin_prompts_excel', async (ctx) => {
  if (!ctx.user || !isAdmin(maxCtxUserId(ctx))) return;

  try {
    await ctx.reply('⏳ Формирую выгрузку промптов и модерации...');

    const videoRows = db_helper.getGenerationsForPromptExport();
    const photoRows = db_helper.getPhotoGenerationsForPromptExport();
    const modRows = db_helper.getModerationLogsForExport();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BananaBot';
    workbook.created = new Date();

    const styleHeader = (sheet: ExcelJS.Worksheet) => {
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      headerRow.height = 20;
    };

    const sheetVideo = workbook.addWorksheet('Видео промпты');
    sheetVideo.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'User ID', key: 'user_id', width: 18 },
      { header: 'Модель', key: 'model', width: 28 },
      { header: 'Статус', key: 'status', width: 12 },
      { header: 'Task ID', key: 'task_id', width: 36 },
      { header: 'Промпт', key: 'prompt', width: 80 },
      { header: 'Дата', key: 'created_at', width: 22 }
    ];
    styleHeader(sheetVideo);
    videoRows.forEach((r, idx) => {
      const row = sheetVideo.addRow(r);
      if (idx % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8F1' } };
      }
    });
    if (videoRows.length > 0) {
      sheetVideo.autoFilter = { from: 'A1', to: 'G1' };
    }

    const sheetPhoto = workbook.addWorksheet('Фото промпты');
    sheetPhoto.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'User ID', key: 'user_id', width: 18 },
      { header: 'Модель', key: 'model', width: 36 },
      { header: 'Статус', key: 'status', width: 12 },
      { header: 'Task ID', key: 'task_id', width: 36 },
      { header: 'Промпт', key: 'prompt', width: 80 },
      { header: 'Дата', key: 'created_at', width: 22 }
    ];
    styleHeader(sheetPhoto);
    photoRows.forEach((r, idx) => {
      const row = sheetPhoto.addRow(r);
      if (idx % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8F1' } };
      }
    });
    if (photoRows.length > 0) {
      sheetPhoto.autoFilter = { from: 'A1', to: 'G1' };
    }

    const sheetMod = workbook.addWorksheet('Блокировки модерации');
    sheetMod.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Дата', key: 'created_at', width: 22 },
      { header: 'User ID', key: 'user_id', width: 18 },
      { header: 'Сообщение', key: 'message', width: 28 },
      { header: 'Детали (JSON)', key: 'details', width: 90 }
    ];
    styleHeader(sheetMod);
    modRows.forEach((r, idx) => {
      const row = sheetMod.addRow({
        id: r.id,
        created_at: r.created_at,
        user_id: r.user_id ?? '',
        message: r.message,
        details: r.details ?? ''
      });
      if (idx % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
      }
    });
    if (modRows.length > 0) {
      sheetMod.autoFilter = { from: 'A1', to: 'E1' };
    }

    const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `prompts_moderation_${dateStamp}.xlsx`;

    const excelBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const uploadInfo = await (bot.api as any).raw.uploads.getUploadUrl({ type: 'file' });
    const formData = new FormData();
    formData.append(
      'data',
      new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }),
      fileName
    );
    const uploadRes = await fetch(uploadInfo.url, { method: 'POST', body: formData });
    const uploadResult = (await uploadRes.json()) as any;
    const mediaToken: string = uploadResult?.token ?? uploadInfo?.token;
    if (!mediaToken) throw new Error('No media token received from upload');

    const fileAttach = new FileAttachment({ token: mediaToken });
    await ctx.reply(
      `📝 Промпты и модерация\n🕐 ${now} МСК\n\n` +
        `• Видео: ${videoRows.length} строк\n` +
        `• Фото: ${photoRows.length} строк\n` +
        `• Блокировки фильтра: ${modRows.length} строк`,
      {
        attachments: [
          fileAttach.toJson(),
          Keyboard.inlineKeyboard([[Keyboard.button.callback('⬅️ Назад', 'admin_refresh_stats')]])
        ]
      }
    );
  } catch (error) {
    logger.error('admin', 'Prompts Excel export error', error);
    await ctx.reply('❌ Ошибка при создании выгрузки промптов.');
  }
});

bot.action('admin_add_bananas_start', (ctx) => {
  if (!ctx.user || !isAdmin(maxCtxUserId(ctx))) return;
  
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'is_admin_adding_bananas', 1);
  
  return ctx.reply('🍌 Введите ID пользователя и количество бананов через пробел.\nПример: 123456789 50');
});

bot.action('admin_broadcast_start', (ctx) => {
  if (!ctx.user || !isAdmin(maxCtxUserId(ctx))) return;

  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'is_admin_broadcasting', 1);

  return ctx.reply(
    '📢 Режим рассылки активирован.\n\n' +
    'Отправьте сообщение для рассылки:\n' +
    '• Просто текст\n' +
    '• Фото (без подписи)\n' +
    '• Фото + подпись\n\n' +
    'Для отмены отправьте /start'
  );
});

// --- VIDEO HANDLERS ---
bot.action('create_video', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const user = db_helper.getUser(userId);
  if (!user) return;

  // Set awaiting prompt status and reset all other states/media on entry
  db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 1);
  db_helper.updateVideoSetting(userId, 'stored_image_url', null);
  db_helper.updateVideoSetting(userId, 'stored_video_url', null);
  db_helper.updateVideoSetting(userId, 'photo_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);
  db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
  clearPhotoKieSelection(userId);

  const updatedUser = db_helper.getUser(userId)!;

  return ctx.editMessage({
    text: getVideoMenuText(updatedUser),
    attachments: [getVideoMenuKeyboard(updatedUser)]
  });
});

// Dynamic settings handlers
bot.action(/^set_mode_(.+)$/, (ctx) => {
  const p = ctx.callback?.payload;
  if (!ctx.user || !p) return;
  const mode = p.replace('set_mode_', '');
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'video_mode', mode);
  
  const user = db_helper.getUser(userId);
  if (!user) return;

  return ctx.editMessage({
    text: getVideoMenuText(user),
    attachments: [getVideoMenuKeyboard(user)]
  });
});

bot.action(/^set_model_(.+)$/, (ctx) => {
  const p = ctx.callback?.payload;
  if (!ctx.user || !p) return;
  const model = p.replace('set_model_', '');
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'video_model', model);

  // Grok always works in image-to-video mode, reset duration to valid default
  if (model === 'grok_img2video') {
    db_helper.updateVideoSetting(userId, 'video_mode', 'photo_to_video');
    db_helper.updateVideoSetting(userId, 'video_duration', '10 сек');
    db_helper.updateVideoSetting(userId, 'video_ratio', '16:9');
  }

  if (model === 'seedance_2') {
    const u = db_helper.getUser(userId);
    if (u) {
      saveVideoGenPrefs(userId, { ...DEFAULT_VIDEO_GEN_PREFS, ...parseVideoGenPrefs(u) });
      const m = u.video_duration.match(/(\d+)/);
      const sec = m ? parseInt(m[1], 10) : 8;
      if (![4, 8, 12].includes(sec)) {
        db_helper.updateVideoSetting(userId, 'video_duration', '8 сек');
      }
      const okRatio = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'].includes(u.video_ratio);
      if (!okRatio) {
        db_helper.updateVideoSetting(userId, 'video_ratio', '16:9');
      }
    }
  } else {
    const u = db_helper.getUser(userId);
    if (u?.video_ratio === 'adaptive') {
      db_helper.updateVideoSetting(userId, 'video_ratio', '16:9');
    }
  }

  const user = db_helper.getUser(userId);
  if (!user) return;

  return ctx.editMessage({
    text: getVideoMenuText(user),
    attachments: [getVideoMenuKeyboard(user)]
  });
});

bot.action(/^set_grok_mode_(.+)$/, (ctx) => {
  const p = ctx.callback?.payload;
  if (!ctx.user || !p) return;
  const mode = p.replace('set_grok_mode_', '');
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'grok_mode', mode);

  const user = db_helper.getUser(userId);
  if (!user) return;

  return ctx.editMessage({
    text: getVideoMenuText(user),
    attachments: [getVideoMenuKeyboard(user)]
  });
});

bot.action(/^set_ratio_(.+)$/, (ctx) => {
  const p = ctx.callback?.payload;
  if (!ctx.user || !p) return;
  const ratio = p.replace('set_ratio_', '');
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'video_ratio', ratio);
  
  const user = db_helper.getUser(userId);
  if (!user) return;

  return ctx.editMessage({
    text: getVideoMenuText(user),
    attachments: [getVideoMenuKeyboard(user)]
  });
});

bot.action(/^set_duration_(.+)$/, (ctx) => {
  const p = ctx.callback?.payload;
  if (!ctx.user || !p) return;
  const duration = p.replace('set_duration_', '');
  const userId = maxCtxUserId(ctx);
  db_helper.updateVideoSetting(userId, 'video_duration', duration);
  
  const user = db_helper.getUser(userId);
  if (!user) return;

  return ctx.editMessage({
    text: getVideoMenuText(user),
    attachments: [getVideoMenuKeyboard(user)]
  });
});

const patchSeed2Prefs = (userId: string, patch: Partial<import('./handlers/video').VideoGenPrefs>) => {
  const u = db_helper.getUser(userId);
  if (!u) return;
  saveVideoGenPrefs(userId, { ...parseVideoGenPrefs(u), ...patch });
};

bot.action(/^set_seed2_audio_(0|1)$/, (ctx) => {
  const p = ctx.callback?.payload;
  if (!ctx.user || !p) return;
  const on = p.endsWith('1');
  const userId = maxCtxUserId(ctx);
  patchSeed2Prefs(userId, { seedance2_generate_audio: on });
  const user = db_helper.getUser(userId);
  if (!user) return;
  return ctx.editMessage({
    text: getVideoMenuText(user),
    attachments: [getVideoMenuKeyboard(user)]
  });
});

const resetMainMenuUserState = (userId: string) => {
  db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 0);
  db_helper.updateVideoSetting(userId, 'stored_image_url', null);
  db_helper.updateVideoSetting(userId, 'stored_video_url', null);
  db_helper.updateVideoSetting(userId, 'photo_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_references', '[]');
  db_helper.updateVideoSetting(userId, 'motion_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);
  db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
  clearPhotoKieSelection(userId);
};

bot.action('main_menu', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const user = db_helper.getUser(userId);
  if (!user) return;

  resetMainMenuUserState(userId);
  const u = db_helper.getUser(userId)!;

  return ctx.editMessage({
    text: getMainMenuText(u.balance),
    format: MAIN_MENU_FORMAT,
    attachments: [getMainMenuKeyboard()]
  });
});

/** Главное меню новым сообщением — не затирает карточку/результат (фото, видео и т.п.) */
bot.action('main_menu_reply', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const user = db_helper.getUser(userId);
  if (!user) return;

  resetMainMenuUserState(userId);
  const u = db_helper.getUser(userId)!;

  return ctx.reply(getMainMenuText(u.balance), {
    format: MAIN_MENU_FORMAT,
    attachments: [getMainMenuKeyboard()]
  });
});

// video_menu alias for create_video (used in some inline keyboards)
bot.action('video_menu', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const user = db_helper.getUser(userId);
  if (!user) return;

  db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 1);
  db_helper.updateVideoSetting(userId, 'stored_image_url', null);
  db_helper.updateVideoSetting(userId, 'stored_video_url', null);
  db_helper.updateVideoSetting(userId, 'photo_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);
  db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
  clearPhotoKieSelection(userId);

  const updatedUser = db_helper.getUser(userId)!;
  return ctx.editMessage({
    text: getVideoMenuText(updatedUser),
    attachments: [getVideoMenuKeyboard(updatedUser)]
  });
});

// photo_menu alias for create_photo (used in some inline keyboards)
bot.action('photo_menu', (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  let user = db_helper.getUser(userId);
  if (!user) return;

  db_helper.updateVideoSetting(userId, 'photo_state', 'awaiting_refs');
  db_helper.updateVideoSetting(userId, 'photo_references', '[]');
  db_helper.updateVideoSetting(userId, 'is_awaiting_prompt', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_state', 'idle');
  db_helper.updateVideoSetting(userId, 'photo_prompt_upload_count', 0);
  db_helper.updateVideoSetting(userId, 'photo_prompt_menu_message_id', null);
  db_helper.updateVideoSetting(userId, 'photo_menu_message_id', null);
  clearPhotoKieSelection(userId);
  user = db_helper.getUser(userId)!;

  persistPhotoMenuMessageId(ctx, userId);
  return ctx.editMessage({
    text: getPhotoMenuText(user),
    attachments: [getPhotoMenuKeyboard(user)]
  });
});
bot.action('photo_prompt', (ctx) => {
  if (!ctx.user) return;
  return showPhotoPromptMenu(ctx);
});
bot.action('top_up', (ctx) => {
  return ctx.editMessage({
    text: getBillingMenuText(),
    attachments: [getBillingMenuKeyboard()]
  });
});
bot.action(/^buy_pack_(\d+)$/, async (ctx) => {
  const p = ctx.callback?.payload;
  if (!ctx.user || !p) return;
  const userId = maxCtxUserId(ctx);
  const bananas = parseInt(p.replace('buy_pack_', ''), 10);
  const pack = PACKS.find(p => p.bananas === bananas);
  if (!pack) return ctx.reply('❌ Пакет не найден.');

  try {
    const orderId = `${userId}_${Date.now()}`;
    const result = await tbank.createPayment(orderId, pack.bananas, pack.rubles);

    db_helper.savePayment(userId, result.paymentId, pack.bananas);

    await ctx.reply(
      `💳 Счёт создан!\n\n` +
      `📦 Пакет: ${pack.label}\n\n` +
      `Нажмите кнопку ниже для оплаты. После успешной оплаты бананы начислятся автоматически в течение минуты.`,
      {
        attachments: [
          Keyboard.inlineKeyboard([
            [Keyboard.button.link('💳 Оплатить', result.paymentUrl)],
            [Keyboard.button.callback('🔄 Проверить оплату', 'check_payment')],
            [Keyboard.button.callback('❌ Отмена', 'top_up')]
          ])
        ]
      }
    );

    // Start polling payment status in background
    pollPaymentStatus(ctx, userId, result.paymentId, pack.bananas);
  } catch (error: any) {
    logger.error('tbank', 'T-Bank payment error', error.response?.data || error.message);
    await ctx.reply('❌ Ошибка при создании платежа. Попробуйте позже.');
  }
});

bot.action('check_payment', async (ctx) => {
  if (!ctx.user) return;
  const userId = maxCtxUserId(ctx);
  const user = db_helper.getUser(userId);
  if (!user?.pending_payment_id) {
    return ctx.reply('❌ Активный платёж не найден.');
  }
  try {
    const status = await tbank.getPaymentStatus(user.pending_payment_id);
    if (status === 'CONFIRMED') {
      const done = db_helper.tryCompletePaymentByPaymentId(user.pending_payment_id);
      const updated = db_helper.getUser(userId)!;
      if (done) {
        return ctx.reply(`✅ Оплата подтверждена! Начислено ${done.bananas} 🍌\n🍌 Баланс: ${updated.balance} 🍌`);
      }
      if (!updated.pending_payment_id) {
        return ctx.reply(`✅ Оплата уже учтена.\n🍌 Баланс: ${updated.balance} 🍌`);
      }
      return ctx.reply(`✅ Оплата подтверждена.\n🍌 Баланс: ${updated.balance} 🍌`);
    }
    return ctx.reply(`⏳ Статус платежа: ${status}\n\nОплата ещё не подтверждена. Попробуйте через минуту.`);
  } catch (error) {
    return ctx.reply('❌ Не удалось проверить статус платежа.');
  }
});

// Background polling for payment — checks every 10s for up to 15 minutes
const pollPaymentStatus = async (ctx: any, userId: string, paymentId: string, bananas: number) => {
  const maxAttempts = 90; // 15 min
  let attempts = 0;
  while (attempts < maxAttempts) {
    await sleep(10000);
    try {
      const status = await tbank.getPaymentStatus(paymentId);
      if (status === 'CONFIRMED') {
        const done = db_helper.tryCompletePaymentByPaymentId(paymentId);
        const updated = db_helper.getUser(userId)!;
        if (done) {
          await ctx.reply(
            `✅ Оплата прошла успешно!\n\nНачислено: ${done.bananas} 🍌\n🍌 Баланс: ${updated.balance} 🍌`,
            {
              attachments: [
                Keyboard.inlineKeyboard([[Keyboard.button.callback('🏠 В меню', 'main_menu_reply')]])
              ]
            }
          );
          return;
        }
        if (!updated.pending_payment_id) {
          await ctx.reply(
            `✅ Оплата уже учтена.\n🍌 Баланс: ${updated.balance} 🍌`,
            {
              attachments: [
                Keyboard.inlineKeyboard([[Keyboard.button.callback('🏠 В меню', 'main_menu_reply')]])
              ]
            }
          );
          return;
        }
      }
      if (status === 'CANCELED' || status === 'REJECTED' || status === 'DEADLINE_EXPIRED') {
        db_helper.clearPayment(userId);
        await ctx.reply('❌ Платёж отменён или истёк срок оплаты.');
        return;
      }
    } catch (e) {
      logger.error('tbank', 'Payment polling error', e);
    }
    attempts++;
  }
  // Timeout — clear pending state
  db_helper.clearPayment(userId);
};
// Global error handler
bot.catch((err) => {
  console.error('Bot error:', err);
});

// Start daily report scheduler (sends to admin at 21:00 MSK)
startScheduler(async (userId, text) => {
  await bot.api.sendMessageToUser(parseInt(userId), text);
});

export default bot;
