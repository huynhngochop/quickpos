/**
 * Webhook SePay — theo tài liệu developer.sepay.vn (đọc ngày 29/10/2026):
 *  - Trường: id, gateway, transactionDate, accountNumber, subAccount, code, content, transferType ('in'|'out'),
 *    description, transferAmount (số nguyên VND), accumulated, referenceCode.
 *  - Xác thực API Key: header `Authorization: Apikey <KEY>`.
 *  - Xác thực HMAC-SHA256: `X-SePay-Signature: sha256=<hex>` trên chuỗi `<timestamp>.<raw body>`,
 *    `X-SePay-Timestamp` (giây), lệch quá 300 s thì từ chối.
 *  - Trả HTTP 200 với body đúng `{"success": true}` trong 30 s; không thì SePay gửi lại (tối đa 7 lần).
 *  - `id` giữ nguyên khi gửi lại → dùng làm mã chống trùng.
 */
import { bankBinFromName } from './banks.ts';

export interface SepayPayload {
  id: number | string;
  gateway: string;
  transactionDate?: string;
  accountNumber: string;
  subAccount?: string | null;
  code?: string | null;
  content?: string | null;
  transferType: string;
  description?: string | null;
  transferAmount: number;
  accumulated?: number;
  referenceCode?: string | null;
}

export interface NormalizedTxn {
  provider: 'SEPAY';
  txnId: string;
  amount: number;
  content: string;
  bankBin: string | null;
  /** Tài khoản ảo (nếu có) đứng trước tài khoản chính: thử khớp theo thứ tự này */
  accountCandidates: string[];
}

export type ParseResult = { kind: 'txn'; txn: NormalizedTxn } | { kind: 'ignore'; reason: string } | { kind: 'invalid'; reason: string };

export function parseSepay(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) return { kind: 'invalid', reason: 'body không phải JSON object' };
  const p = body as Partial<SepayPayload>;
  if (p.id === undefined || p.id === null || String(p.id).length === 0) return { kind: 'invalid', reason: 'thiếu id' };
  if (p.transferType !== 'in') return { kind: 'ignore', reason: `transferType=${String(p.transferType)}` };
  const amount = Number(p.transferAmount);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { kind: 'invalid', reason: 'transferAmount không hợp lệ' };
  if (typeof p.accountNumber !== 'string' || p.accountNumber.length === 0) {
    return { kind: 'invalid', reason: 'thiếu accountNumber' };
  }
  const accounts: string[] = [];
  if (typeof p.subAccount === 'string' && p.subAccount.trim()) accounts.push(p.subAccount.trim());
  if (!accounts.includes(p.accountNumber.trim())) accounts.push(p.accountNumber.trim());
  // Nội dung: ghép `code` (SePay tự nhận diện mã thanh toán, có thể null) với nội dung gốc
  const content = [typeof p.code === 'string' ? p.code : '', p.content ?? '', p.description ?? '']
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
  return {
    kind: 'txn',
    txn: {
      provider: 'SEPAY',
      txnId: String(p.id),
      amount,
      content,
      bankBin: bankBinFromName(p.gateway),
      accountCandidates: accounts,
    },
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifySepayApiKey(authorization: string | null, apiKey: string): boolean {
  if (!authorization || !apiKey || !authorization.startsWith('Apikey ')) return false;
  return timingSafeEqual(authorization.slice(7), apiKey);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySepayHmac(
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!signature || !timestamp || !secret || !/^[0-9]+$/.test(timestamp)) return false;
  if (Math.abs(nowSec - Number(timestamp)) > toleranceSec) return false;
  const expected = `sha256=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
  return timingSafeEqual(expected, signature);
}

/** Body trả về đúng như SePay yêu cầu. */
export const SEPAY_ACK = JSON.stringify({ success: true });

/** Dùng trong test: ký giống SePay. */
export async function signSepayForTest(secret: string, timestamp: string, rawBody: string): Promise<string> {
  return `sha256=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}
