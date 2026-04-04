import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger';

const TERMINAL_KEY = process.env.TBANK_TERMINAL_KEY || '1774620399694DEMO';
const PASSWORD = process.env.TBANK_PASSWORD || '';
const BASE_URL = 'https://securepay.tinkoff.ru/v2';

// Token: sort all params (including Password) alphabetically,
// concatenate values as strings, SHA-256 hash
function generateToken(params: Record<string, any>): string {
  const withPassword = { ...params, Password: PASSWORD };
  const sorted = Object.keys(withPassword)
    .sort()
    .reduce((acc, key) => {
      acc[key] = String(withPassword[key]);
      return acc;
    }, {} as Record<string, string>);
  const str = Object.values(sorted).join('');
  return crypto.createHash('sha256').update(str).digest('hex');
}

export const PACKS: { bananas: number; rubles: number; label: string }[] = [
  { bananas: 15,  rubles: 150,  label: '🍌 Мини: 15 🍌 — 150₽' },
  { bananas: 30,  rubles: 250,  label: '🍌🍌 Стандарт: 30 🍌 — 250₽' },
  { bananas: 50,  rubles: 400,  label: '🍌🍌🍌 Оптимальный: 50 🍌 — 400₽ 🔥' },
  { bananas: 100, rubles: 700,  label: '🍌🍌🍌🍌 Про: 100 🍌 — 700₽' },
  { bananas: 200, rubles: 1400, label: '🍌🍌🍌🍌🍌 Студия: 200 🍌 — 1400₽' },
];

export interface InitResult {
  paymentId: string;
  paymentUrl: string;
}

export const tbank = {
  createPayment: async (orderId: string, bananas: number, rubles: number): Promise<InitResult> => {
    const amountKopecks = rubles * 100;
    const params: Record<string, any> = {
      TerminalKey: TERMINAL_KEY,
      Amount: amountKopecks,
      OrderId: orderId,
      Description: `Пополнение баланса: ${bananas} 🍌`,
    };
    const token = generateToken(params);

    const response = await axios.post(`${BASE_URL}/Init`, { ...params, Token: token });
    logger.info('tbank', 'T-Bank Init response', response.data);

    if (response.data.Success) {
      return {
        paymentId: String(response.data.PaymentId),
        paymentUrl: response.data.PaymentURL,
      };
    }
    throw new Error(response.data.Message || 'T-Bank payment creation failed');
  },

  getPaymentStatus: async (paymentId: string): Promise<string> => {
    const params: Record<string, any> = {
      TerminalKey: TERMINAL_KEY,
      PaymentId: paymentId,
    };
    const token = generateToken(params);

    const response = await axios.post(`${BASE_URL}/GetState`, { ...params, Token: token });
    return response.data.Status as string;
  },
};
