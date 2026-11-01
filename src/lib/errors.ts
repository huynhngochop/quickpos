/**
 * Chuẩn hóa lỗi từ Supabase/mạng thành mã ổn định → câu tiếng Việt (docs/api.md mục 6).
 * Component chỉ hiện `AppError.message`; `detail` chỉ để ghi log (không chứa số điện thoại, MST).
 */
import { vi, type ErrorCode } from '../i18n/vi';

export type ErrorAction = 'relogin' | 'none' | 'new_order_id' | 'reload' | 'open_review' | 'queue' | 'retry_later';

const ACTIONS: Record<ErrorCode, ErrorAction> = {
  QP_UNAUTHENTICATED: 'relogin',
  QP_FORBIDDEN: 'none',
  QP_INVALID_INPUT: 'none',
  QP_INVALID_ITEMS: 'none',
  QP_ORDER_CONFLICT: 'new_order_id',
  QP_NOT_FOUND: 'reload',
  QP_ORDER_NOT_CANCELLABLE: 'open_review',
  QP_ORDER_NOT_CONFIRMABLE: 'reload',
  QP_ALREADY_ASSIGNED: 'reload',
  QP_TAX_CODE_TAKEN: 'none',
  QP_NO_PAYMENT_ACCOUNT: 'none',
  QP_ORDER_NOT_PAYABLE: 'reload',
  QP_CONSENT_REQUIRED: 'none',
  QP_PAYMENT_EXCEEDS_DEBT: 'none',
  NETWORK: 'queue',
  UNKNOWN: 'retry_later',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly action: ErrorAction;
  readonly detail?: string;
  constructor(code: ErrorCode, detail?: string) {
    super(vi.errors[code]);
    this.name = 'AppError';
    this.code = code;
    this.action = ACTIONS[code];
    this.detail = detail;
  }
  get retryable(): boolean {
    return this.code === 'NETWORK';
  }
}

const QP_CODE = /^QP_[A-Z_]+$/;

function isKnown(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(vi.errors, code);
}

/** Lỗi dạng { message, code, details } của PostgREST / Auth / fetch. */
interface LooseError {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  status?: unknown;
  name?: unknown;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = (typeof err === 'object' && err !== null ? err : { message: String(err) }) as LooseError;
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const detail = [code, typeof e.details === 'string' ? e.details : ''].filter(Boolean).join(' | ') || undefined;

  if (QP_CODE.test(message)) {
    return new AppError(isKnown(message) ? message : 'UNKNOWN', detail ?? message);
  }
  // JWT hết hạn / không hợp lệ (PostgREST) hoặc 401 từ Auth
  if (code === 'PGRST301' || code === 'PGRST302' || e.status === 401) {
    return new AppError('QP_UNAUTHENTICATED', detail);
  }
  if (isNetworkLike(e, message)) return new AppError('NETWORK', message || undefined);
  return new AppError('UNKNOWN', detail ?? (message || undefined));
}

function isNetworkLike(e: LooseError, message: string): boolean {
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  if (e.status === 0) return true;
  return /network request failed|failed to fetch|network ?error|timed? ?out|fetch failed|load failed|failed to send a request/i.test(message);
}
