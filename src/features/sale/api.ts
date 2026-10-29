import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { callWithRetry, unwrap } from '../../lib/retry';
import { AppError, toAppError } from '../../lib/errors';
import type { Order, OrderItemInput, QrForOrder } from '../../types/api';

export const ORDER_COLS =
  'id, business_id, order_code, total_amount, amount_received, overpaid_amount, payment_method, payment_status, paid_at, manual_confirmed_by, manual_confirmed_at, manual_note, sold_at, client_sold_at, clock_suspect, created_device_id, created_by, created_at, updated_at';

export async function createOrder(args: {
  orderId: string;
  businessId: string;
  items: OrderItemInput[];
  deviceId: string;
}): Promise<Order> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('create_order_v1', {
          p_order_id: args.orderId,
          p_business_id: args.businessId,
          p_items: args.items,
          p_payment_method: 'VIETQR',
          p_sold_at: new Date().toISOString(),
          p_device_id: args.deviceId,
        })
        .abortSignal(signal),
    ) as Order,
  );
}

export async function getOrder(orderId: string): Promise<Order> {
  return callWithRetry(async (signal) =>
    unwrap(await supabase.from('orders').select(ORDER_COLS).eq('id', orderId).single().abortSignal(signal)) as Order,
  );
}

export async function cancelOrder(orderId: string): Promise<Order> {
  return callWithRetry(async (signal) =>
    unwrap(await supabase.rpc('cancel_order_v1', { p_order_id: orderId }).abortSignal(signal)) as Order,
  );
}

export async function confirmTransferManually(orderId: string, note: string | null): Promise<Order> {
  return callWithRetry(async (signal) =>
    unwrap(await supabase.rpc('confirm_transfer_manually_v1', { p_order_id: orderId, p_note: note }).abortSignal(signal)) as Order,
  );
}

/** Edge Function trả lỗi dạng { error: 'QP_...' } — đọc ra để tra câu tiếng Việt. */
async function functionError(error: unknown): Promise<AppError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await (error.context as Response).json()) as { error?: string };
      if (body.error) return toAppError({ message: body.error });
    } catch {
      /* body không phải JSON */
    }
  }
  return toAppError(error);
}

export async function qrForOrder(orderId: string): Promise<QrForOrder> {
  return callWithRetry(async () => {
    const { data, error } = await supabase.functions.invoke<QrForOrder>('qr-for-order', { body: { order_id: orderId } });
    if (error) throw await functionError(error);
    if (!data) throw new AppError('UNKNOWN', 'qr-for-order: không có dữ liệu');
    return data;
  });
}
