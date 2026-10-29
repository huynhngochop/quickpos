/**
 * Mã PIN 4 số của chủ quán, chỉ lưu trên máy (SecureStore), dạng băm có muối.
 * PIN 4 số chỉ có 10.000 khả năng nên điều bảo vệ thật là khóa tạm sau nhiều lần sai.
 * Hàm thuần: phần băm và phần lưu được truyền vào để test.
 */

export const PIN_LENGTH = 4;
export const MAX_FAILS_BEFORE_LOCK = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;

export interface PinRecord {
  salt: string;
  hash: string;
}

export interface PinGuardState {
  fails: number;
  lockedUntil: number; // epoch ms, 0 = không khóa
}

export const initialGuard: PinGuardState = { fails: 0, lockedUntil: 0 };

export type Hasher = (input: string) => Promise<string>;

/** Từ chối mã quá dễ đoán: 4 số giống nhau, dãy tăng/giảm liền (1234, 9876). */
export function isPinTooEasy(pin: string): boolean {
  if (!/^[0-9]{4}$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  if (d.every((x) => x === d[0])) return true;
  const steps = d.slice(1).map((x, i) => x - d[i]!);
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

export async function makePinRecord(pin: string, salt: string, hash: Hasher): Promise<PinRecord> {
  return { salt, hash: await hash(`${salt}:${pin}`) };
}

export type PinCheck =
  | { ok: true; guard: PinGuardState }
  | { ok: false; reason: 'locked'; retryInSec: number; guard: PinGuardState }
  | { ok: false; reason: 'wrong'; triesLeft: number; guard: PinGuardState };

export async function checkPin(
  pin: string,
  record: PinRecord,
  guard: PinGuardState,
  hash: Hasher,
  now: number,
): Promise<PinCheck> {
  if (guard.lockedUntil > now) {
    return { ok: false, reason: 'locked', retryInSec: Math.ceil((guard.lockedUntil - now) / 1000), guard };
  }
  const h = await hash(`${record.salt}:${pin}`);
  if (constantTimeEqual(h, record.hash)) return { ok: true, guard: initialGuard };

  const fails = guard.fails + 1;
  if (fails >= MAX_FAILS_BEFORE_LOCK) {
    // 30 s, 60 s, 120 s… tối đa 15 phút
    const rounds = fails - MAX_FAILS_BEFORE_LOCK;
    const lockMs = Math.min(BASE_LOCK_MS * 2 ** rounds, MAX_LOCK_MS);
    const next = { fails, lockedUntil: now + lockMs };
    return { ok: false, reason: 'locked', retryInSec: Math.ceil(lockMs / 1000), guard: next };
  }
  return { ok: false, reason: 'wrong', triesLeft: MAX_FAILS_BEFORE_LOCK - fails, guard: { fails, lockedUntil: 0 } };
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
