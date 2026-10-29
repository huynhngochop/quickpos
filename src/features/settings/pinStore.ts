/** Lưu mã PIN chủ quán (đã băm) và bộ đếm nhập sai trong SecureStore. */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { checkPin, initialGuard, makePinRecord, type PinCheck, type PinGuardState, type PinRecord } from './pinLogic';

const PIN_KEY = 'quickpos.owner_pin';
const GUARD_KEY = 'quickpos.owner_pin_guard';

const sha256 = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function hasOwnerPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PIN_KEY)) !== null;
}

export async function saveOwnerPin(pin: string): Promise<void> {
  const record = await makePinRecord(pin, Crypto.randomUUID(), sha256);
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(record));
  await SecureStore.setItemAsync(GUARD_KEY, JSON.stringify(initialGuard));
}

export async function verifyOwnerPin(pin: string): Promise<PinCheck> {
  const record = await readJson<PinRecord>(PIN_KEY);
  if (!record) return { ok: true, guard: initialGuard };   // chưa đặt PIN (máy thu ngân) — màn gọi tự xử lý
  const guard = (await readJson<PinGuardState>(GUARD_KEY)) ?? initialGuard;
  const r = await checkPin(pin, record, guard, sha256, Date.now());
  await SecureStore.setItemAsync(GUARD_KEY, JSON.stringify(r.guard));
  return r;
}

export async function clearOwnerPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
  await SecureStore.deleteItemAsync(GUARD_KEY);
}
