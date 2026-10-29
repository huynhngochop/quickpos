/**
 * Gọi API với thời gian chờ 10 giây và thử lại 3 lần (1 s, 3 s, 9 s) với CÙNG tham số (docs/api.md mục 1).
 * Chỉ thử lại lỗi mạng/hết giờ. Lỗi nghiệp vụ (QP_*) trả về ngay.
 */
import { AppError, toAppError } from './errors';

export interface RetryOptions {
  timeoutMs?: number;
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, err: AppError) => void;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_DELAYS_MS = [1_000, 3_000, 9_000] as const;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Chạy `fn` với AbortSignal hết hạn sau `timeoutMs`. */
export async function withTimeout<T>(fn: (signal: AbortSignal) => PromiseLike<T>, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new AppError('NETWORK', `timeout ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(fn(ctrl.signal)), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function callWithRetry<T>(fn: (signal: AbortSignal) => PromiseLike<T>, opts: RetryOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(fn, timeoutMs);
    } catch (raw) {
      const err = toAppError(raw);
      if (!err.retryable || attempt >= delays.length) throw err;
      opts.onRetry?.(attempt + 1, err);
      await sleep(delays[attempt]!);
    }
  }
}

/**
 * supabase-js trả lỗi trong `{ data, error }` thay vì ném. Đổi thành ném AppError để dùng chung retry.
 */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw toAppError(res.error);
  return res.data as T;
}
