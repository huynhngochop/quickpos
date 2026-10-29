/**
 * Quyết định có gửi thông báo đẩy "tiền về" không, từ payload Database Webhook của Supabase
 * ({ type, table, record, old_record }). Chỉ gửi tới máy tạo đơn (created_device_id).
 */
import { capitalize, formatVND, readVND } from './vnmoney.ts';

export interface OrderRecord {
  payment_status: string;
  amount_received: number;
  total_amount: number;
  created_device_id: string | null;
  business_id: string;
  manual_confirmed_at?: string | null;
}

export interface DbWebhook {
  type: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  record: OrderRecord | null;
  old_record: OrderRecord | null;
}

export interface PushDecision {
  deviceId: string;
  title: string;
  body: string;
}

export function decidePush(evt: DbWebhook): PushDecision | null {
  if (evt.type !== 'UPDATE' || !evt.record || !evt.old_record) return null;
  const r = evt.record;
  const o = evt.old_record;
  if (!r.created_device_id) return null;
  // Chỉ báo khi tiền ngân hàng thật sự về (amount_received tăng). Xác nhận tay không có tiền mới → không báo.
  if (r.amount_received <= o.amount_received) return null;

  if (r.payment_status === 'PAID') {
    const got = Math.max(r.amount_received, r.total_amount);
    return { deviceId: r.created_device_id, title: `Đã nhận ${formatVND(got)}`, body: capitalize(readVND(got)) };
  }
  if (r.payment_status === 'UNPAID' && r.amount_received < r.total_amount) {
    const missing = r.total_amount - r.amount_received;
    return {
      deviceId: r.created_device_id,
      title: `Mới nhận ${formatVND(r.amount_received)}, còn thiếu ${formatVND(missing)}`,
      body: 'Đưa khách quét mã cho phần còn thiếu.',
    };
  }
  return null;
}
