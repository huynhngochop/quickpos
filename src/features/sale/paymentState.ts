/**
 * Từ một dòng `orders` suy ra màn hình thu ngân cần hiện (canvas 2.3–2.6) và có cần đọc to không.
 * Hàm thuần — nguồn sự thật là DB; Realtime chỉ báo "có thay đổi".
 */
import type { Order } from '../../types/api';
import { formatVND, readNumber } from '../../lib/money';
import { vi } from '../../i18n/vi';

export type PaymentView =
  | { kind: 'WAITING'; total: number }
  | { kind: 'PARTIAL'; total: number; received: number; missing: number }
  | { kind: 'PAID'; total: number; received: number; manual: boolean }
  | { kind: 'OVERPAID'; total: number; received: number; over: number }
  | { kind: 'CANCELLED'; total: number };

type OrderLike = Pick<
  Order,
  'total_amount' | 'amount_received' | 'payment_status' | 'manual_confirmed_at' | 'created_device_id'
>;

export function paymentView(o: OrderLike): PaymentView {
  const total = o.total_amount;
  const received = o.amount_received;
  switch (o.payment_status) {
    case 'CANCELLED':
    case 'REFUNDED':
      return { kind: 'CANCELLED', total };
    case 'PAID':
      if (received > total) return { kind: 'OVERPAID', total, received, over: received - total };
      // Xác nhận tay: tiền ngân hàng có thể chưa về (received < total) — vẫn là đã thu ở quầy
      return { kind: 'PAID', total, received, manual: o.manual_confirmed_at !== null && received < total };
    case 'UNPAID':
    default:
      if (received > 0 && received < total) return { kind: 'PARTIAL', total, received, missing: total - received };
      return { kind: 'WAITING', total };
  }
}

/**
 * Câu đọc to khi trạng thái đổi; null = im lặng.
 * Chỉ máy tạo đơn đọc, chỉ khi bật "Đọc to khi tiền về", chỉ khi có tiền mới về
 * (không đọc khi mở lại màn hình của đơn đã trả từ trước).
 */
export function announcement(
  prev: OrderLike | null,
  next: OrderLike,
  deviceId: string,
  speakEnabled: boolean,
): string | null {
  if (!speakEnabled || next.created_device_id !== deviceId) return null;
  if (!prev) return null;
  const moneyArrived = next.amount_received > prev.amount_received;
  const becamePaid = prev.payment_status !== 'PAID' && next.payment_status === 'PAID';
  if (!moneyArrived && !becamePaid) return null;

  const v = paymentView(next);
  switch (v.kind) {
    case 'PAID':
      // Xác nhận tay: chính người bấm vừa bấm, không cần đọc
      return v.manual ? null : vi.paid.speakPaid(readNumber(v.total));
    case 'OVERPAID':
      return vi.paid.speakPaid(readNumber(v.received));
    case 'PARTIAL':
      return vi.paid.speakPartial(readNumber(v.received), readNumber(v.missing));
    default:
      return null;
  }
}

/** Tiêu đề thông báo đẩy khi app ở nền. */
export function paidNotificationTitle(o: OrderLike): string {
  return vi.notify.paidTitle(formatVND(Math.max(o.amount_received, o.total_amount)));
}
