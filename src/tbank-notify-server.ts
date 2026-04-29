import http from 'http';
import { db_helper } from './db';
import { logger } from './utils/logger';
import { verifyTbankNotificationToken } from './utils/tbank';

const NOTIFY_PATH = process.env.TBANK_NOTIFY_PATH || '/tbank/notify';
const MAX_WEBHOOK_PATH = process.env.MAX_WEBHOOK_PATH || '/max/webhook';
const MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET || '';
const PORT = parseInt(process.env.TBANK_NOTIFY_PORT || '8787', 10);

function parseBody(raw: string, contentType: string): Record<string, unknown> {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (ct === 'application/json' || ct === 'text/json') {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  const params = new URLSearchParams(raw);
  const o: Record<string, unknown> = {};
  params.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

function isTruthySuccess(v: unknown): boolean {
  return v === true || v === 'true';
}

export interface HttpServerOptions {
  /** Если передан — подключается роут /max/webhook, в который скармливаются апдейты MAX. */
  onMaxUpdate?: (update: unknown) => Promise<void> | void;
}

export function startTbankNotifyServer(opts: HttpServerOptions = {}): http.Server {
  const { onMaxUpdate } = opts;
  const enableMaxWebhook = Boolean(onMaxUpdate);

  console.log(`HTTP-server: поднимаю http://127.0.0.1:${PORT}`);
  console.log(`  • T-Bank notify: ${NOTIFY_PATH}`);
  if (enableMaxWebhook) {
    console.log(`  • MAX webhook:   ${MAX_WEBHOOK_PATH}${MAX_WEBHOOK_SECRET ? ' (secret on)' : ' (no secret)'}`);
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 404;
      res.end();
      return;
    }

    const isTbankRoute = req.url === NOTIFY_PATH;
    const isMaxRoute = enableMaxWebhook && req.url === MAX_WEBHOOK_PATH;

    if (!isTbankRoute && !isMaxRoute) {
      res.statusCode = 404;
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');

      // ── MAX webhook ───────────────────────────────────────────
      if (isMaxRoute) {
        if (MAX_WEBHOOK_SECRET) {
          const got = req.headers['x-max-bot-api-secret'];
          if (got !== MAX_WEBHOOK_SECRET) {
            logger.warn('webhook', 'MAX webhook: invalid secret header', String(got ?? ''));
            res.statusCode = 403;
            res.end();
            return;
          }
        }
        let update: unknown;
        try {
          update = JSON.parse(raw);
        } catch (e) {
          logger.warn('webhook', 'MAX webhook: invalid JSON body', raw.slice(0, 200));
          res.statusCode = 400;
          res.end();
          return;
        }
        // Отдаём 200 СРАЗУ — MAX не должен ждать обработки апдейта.
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('OK');
        // Обрабатываем асинхронно.
        Promise.resolve()
          .then(() => onMaxUpdate!(update))
          .catch((err) => {
            logger.error('webhook', 'MAX webhook: handleUpdate failed', err);
          });
        return;
      }

      // ── T-Bank notify ─────────────────────────────────────────
      let body: Record<string, unknown>;
      try {
        body = parseBody(raw, req.headers['content-type'] || '');
      } catch {
        res.statusCode = 400;
        res.end();
        return;
      }

      if (!verifyTbankNotificationToken(body)) {
        logger.warn('tbank', 'Notify: invalid token', JSON.stringify(body));
        res.statusCode = 403;
        res.end();
        return;
      }

      const status = String(body.Status ?? '');
      const paymentId = body.PaymentId != null ? String(body.PaymentId) : '';

      if (status === 'CONFIRMED' && isTruthySuccess(body.Success) && paymentId) {
        const done = db_helper.tryCompletePaymentByPaymentId(paymentId);
        if (done) {
          logger.info('tbank', `Notify: credited ${done.bananas} bananas`, done.userId);
        }
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('OK');
    });
  });

  server.on('error', (err) => {
    console.error('HTTP-server: ошибка', err);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`HTTP-server: слушаю http://127.0.0.1:${PORT}`);
  });

  return server;
}
