/**
 * Sổ một ngày = tổng từ server (daily_sales qua day_summary) + đơn tiền mặt còn trong hàng đợi (docs/api.md mục 7).
 */
import type { DailySalesRow, DaySummaryRow, Order, PaymentMethod } from '../../types/api';
import type { QueuedSale } from '../offline/queue';
import { vnDay } from '../../lib/time';

export interface DayTotals {
  total: number;
  count: number;
  byMethod: Record<PaymentMethod, { amount: number; count: number }>;
  queuedCount: number;
}

export function emptyTotals(): DayTotals {
  return {
    total: 0,
    count: 0,
    byMethod: { VIETQR: { amount: 0, count: 0 }, CASH: { amount: 0, count: 0 }, CARD: { amount: 0, count: 0 } },
    queuedCount: 0,
  };
}

export function combineDay(day: string, server: DaySummaryRow[], queued: QueuedSale[]): DayTotals {
  const t = emptyTotals();
  for (const r of server) {
    t.byMethod[r.method].amount += r.amount;
    t.byMethod[r.method].count += r.orders_count;
    t.total += r.amount;
    t.count += r.orders_count;
  }
  for (const q of queued) {
    if (vnDay(new Date(q.soldAt)) !== day) continue;
    t.byMethod.CASH.amount += q.total;
    t.byMethod.CASH.count += 1;
    t.total += q.total;
    t.count += 1;
    t.queuedCount += 1;
  }
  return t;
}

/** Tổng nhiều ngày (cả tháng) từ các dòng daily_sales. */
export function sumDailySales(rows: DailySalesRow[]): { total: number; count: number } {
  return rows.reduce((a, r) => ({ total: a.total + r.amount, count: a.count + r.orders_count }), { total: 0, count: 0 });
}

/** Con trỏ trang sau cho list_orders (keyset): sold_at + id của dòng cuối. */
export function nextCursor(page: Pick<Order, 'sold_at' | 'id'>[], pageSize: number): { soldAt: string; id: string } | undefined {
  if (page.length < pageSize) return undefined;
  const last = page[page.length - 1]!;
  return { soldAt: last.sold_at, id: last.id };
}
