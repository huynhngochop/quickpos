/**
 * Hàng đợi đơn tiền mặt khi mất mạng (docs/api.md mục 7).
 *  - Mã đơn (UUID) sinh lúc bán và KHÔNG đổi khi gửi lại → server chỉ có một bản ghi.
 *  - Gửi lần lượt bằng create_cash_sale_v1 với đúng tham số đã lưu; thành công mới xóa.
 *  - Lỗi mạng: dừng, giữ nguyên để lần sau gửi tiếp.
 *  - Hết phiên đăng nhập: dừng, giữ nguyên, báo cần đăng nhập lại.
 *  - Lỗi nghiệp vụ không tự hết (dữ liệu sai, không có quyền): đánh dấu STUCK, không thử tự động nữa,
 *    vẫn giữ trên máy để hỗ trợ kiểm tra — không bao giờ tự xóa đơn tiền đã thu.
 * Phần lưu trữ (SQLite) tách ra sau interface để test được bằng bộ nhớ.
 */
import type { OrderItemInput } from '../../types/api';
import { toAppError, type AppError } from '../../lib/errors';

export interface QueuedSale {
  orderId: string;
  businessId: string;
  items: OrderItemInput[];
  total: number;
  soldAt: string;
  deviceId: string;
  attempts: number;
  status: 'PENDING' | 'STUCK';
  lastError: string | null;
  createdAt: string;
}

export interface QueueStore {
  add(sale: QueuedSale): Promise<void>;
  /** Theo thứ tự bán (cũ trước) */
  list(): Promise<QueuedSale[]>;
  remove(orderId: string): Promise<void>;
  update(orderId: string, patch: Pick<QueuedSale, 'attempts' | 'status' | 'lastError'>): Promise<void>;
}

export type SendSale = (sale: QueuedSale) => Promise<unknown>;

export interface FlushResult {
  sent: number;
  remaining: number;
  stuck: number;
  stoppedBy: 'done' | 'network' | 'relogin';
}

export function newQueuedSale(
  args: Pick<QueuedSale, 'orderId' | 'businessId' | 'items' | 'soldAt' | 'deviceId'>,
  now: Date = new Date(),
): QueuedSale {
  const total = args.items.reduce((s, i) => s + Math.round(i.quantity * i.unit_price), 0);
  return { ...args, total, attempts: 0, status: 'PENDING', lastError: null, createdAt: now.toISOString() };
}

export async function flushQueue(store: QueueStore, send: SendSale): Promise<FlushResult> {
  const all = await store.list();
  let sent = 0;
  let stuck = all.filter((s) => s.status === 'STUCK').length;
  for (const sale of all) {
    if (sale.status === 'STUCK') continue;
    try {
      await send(sale);
      await store.remove(sale.orderId);
      sent++;
    } catch (raw) {
      const err: AppError = toAppError(raw);
      const attempts = sale.attempts + 1;
      const lastError = err.detail ?? err.code;
      if (err.code === 'NETWORK' || err.code === 'UNKNOWN') {
        await store.update(sale.orderId, { attempts, status: 'PENDING', lastError });
        return { sent, remaining: all.length - sent, stuck, stoppedBy: 'network' };
      }
      if (err.code === 'QP_UNAUTHENTICATED') {
        await store.update(sale.orderId, { attempts, status: 'PENDING', lastError });
        return { sent, remaining: all.length - sent, stuck, stoppedBy: 'relogin' };
      }
      await store.update(sale.orderId, { attempts, status: 'STUCK', lastError });
      stuck++;
    }
  }
  return { sent, remaining: all.length - sent, stuck, stoppedBy: 'done' };
}

/** Bộ nhớ tạm cho test và cho nền tảng không có SQLite. */
export function memoryQueueStore(initial: QueuedSale[] = []): QueueStore & { items: QueuedSale[] } {
  const items = [...initial];
  return {
    items,
    async add(sale) {
      if (!items.some((s) => s.orderId === sale.orderId)) items.push(sale);
    },
    async list() {
      return [...items].sort((a, b) => a.soldAt.localeCompare(b.soldAt));
    },
    async remove(orderId) {
      const i = items.findIndex((s) => s.orderId === orderId);
      if (i >= 0) items.splice(i, 1);
    },
    async update(orderId, patch) {
      const s = items.find((x) => x.orderId === orderId);
      if (s) Object.assign(s, patch);
    },
  };
}
