/**
 * Hàng đợi đơn tiền mặt: mọi đơn tiền mặt GHI XUỐNG MÁY TRƯỚC rồi mới gửi.
 * Có mạng thì gửi ngay (người dùng không thấy khác); mất mạng thì nằm chờ, tự gửi khi có mạng lại,
 * khi mở app, khi app trở lại từ nền.
 */
import { create } from 'zustand';
import { supabase } from '../../lib/supabase';
import { callWithRetry, unwrap } from '../../lib/retry';
import { queryClient } from '../../lib/queryClient';
import { flushQueue, newQueuedSale, type FlushResult, type QueuedSale } from './queue';
import { sqliteQueueStore } from './sqliteStore';
import type { OrderItemInput } from '../../types/api';

interface QueueState {
  items: QueuedSale[];
  flushing: boolean;
  needsRelogin: boolean;
}

export const useQueue = create<QueueState>(() => ({ items: [], flushing: false, needsRelogin: false }));

export async function refreshQueue(): Promise<void> {
  useQueue.setState({ items: await sqliteQueueStore.list() });
}

async function sendSale(sale: QueuedSale): Promise<unknown> {
  // Cùng tham số mỗi lần gửi lại → server trả về đơn đã có, không tạo trùng
  return callWithRetry(
    async (signal) =>
      unwrap(
        await supabase
          .rpc('create_cash_sale_v1', {
            p_order_id: sale.orderId,
            p_business_id: sale.businessId,
            p_items: sale.items,
            p_sold_at: sale.soldAt,
            p_device_id: sale.deviceId,
          })
          .abortSignal(signal),
      ),
    { delaysMs: [1_000] },
  );
}

let running: Promise<FlushResult> | null = null;

export async function flushNow(): Promise<FlushResult | null> {
  if (running) return running;
  useQueue.setState({ flushing: true });
  running = flushQueue(sqliteQueueStore, sendSale);
  try {
    const r = await running;
    useQueue.setState({ needsRelogin: r.stoppedBy === 'relogin' });
    if (r.sent > 0) {
      void queryClient.invalidateQueries({ queryKey: ['day'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    }
    return r;
  } finally {
    running = null;
    useQueue.setState({ flushing: false });
    await refreshQueue();
  }
}

/** Ghi đơn tiền mặt vào máy rồi thử gửi. Không bao giờ ném lỗi mạng ra ngoài. */
export async function recordCashSale(args: {
  orderId: string;
  businessId: string;
  items: OrderItemInput[];
  deviceId: string;
}): Promise<{ sentNow: boolean }> {
  const sale = newQueuedSale({ ...args, soldAt: new Date().toISOString() });
  await sqliteQueueStore.add(sale);
  await refreshQueue();
  await flushNow();
  const stillQueued = useQueue.getState().items.some((s) => s.orderId === args.orderId);
  return { sentNow: !stillQueued };
}
