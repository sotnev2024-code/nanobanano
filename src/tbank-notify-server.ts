import http from 'http';
import { db_helper } from './db';
import { logger } from './utils/logger';
import { verifyTbankNotificationToken } from './utils/tbank';

const NOTIFY_PATH = process.env.TBANK_NOTIFY_PATH || '/tbank/notify';
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

export function startTbankNotifyServer(): http.Server {
  console.log(`T-Bank notify: поднимаю http://127.0.0.1:${PORT}${NOTIFY_PATH}`);

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== NOTIFY_PATH) {
      res.statusCode = 404;
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
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
    console.error('T-Bank notify: ошибка сервера', err);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`T-Bank notify: слушаю http://127.0.0.1:${PORT}${NOTIFY_PATH}`);
  });

  return server;
}
