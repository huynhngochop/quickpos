/** Tiền cần xem lại — chỉ OWNER/MANAGER/ACCOUNTANT đọc được (RLS), gán tiền chỉ OWNER/MANAGER. */
import { supabase } from '../../lib/supabase';
import { callWithRetry, unwrap } from '../../lib/retry';
import { ORDER_COLS } from '../sale/api';
import type { Order, PaymentEvent, UnreconciledManual } from '../../types/api';

export type ReviewEvent = PaymentEvent & { order: { order_code: string } | null };

const EVENT_COLS =
  'id, business_id, order_id, provider, bank_bin, account_no, amount, transfer_content, match_status, received_at, order:orders(order_code)';

export async function eventsNeedingReview(businessId: string): Promise<ReviewEvent[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('payment_events')
        .select(EVENT_COLS)
        .eq('business_id', businessId)
        .in('match_status', ['UNMATCHED', 'PARTIAL', 'ALREADY_PAID'])
        .order('received_at', { ascending: false })
        .limit(20)
        .abortSignal(signal),
    ) as unknown as ReviewEvent[],
  );
}

export async function getEvent(eventId: string): Promise<ReviewEvent> {
  return callWithRetry(async (signal) =>
    unwrap(await supabase.from('payment_events').select(EVENT_COLS).eq('id', eventId).abortSignal(signal).single()) as unknown as ReviewEvent,
  );
}

export async function unreconciledManual(businessId: string): Promise<UnreconciledManual[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('unreconciled_manual_confirmations')
        .select('id, business_id, order_code, total_amount, amount_received, manual_confirmed_by, manual_confirmed_at, manual_note')
        .eq('business_id', businessId)
        .order('manual_confirmed_at', { ascending: false })
        .limit(20)
        .abortSignal(signal),
    ) as UnreconciledManual[],
  );
}

/** Đơn chưa trả cùng số tiền (index riêng orders_unpaid_by_amount) */
export async function candidateOrders(businessId: string, amount: number): Promise<Order[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('orders')
        .select(ORDER_COLS)
        .eq('business_id', businessId)
        .eq('payment_status', 'UNPAID')
        .eq('total_amount', amount)
        .order('created_at', { ascending: false })
        .limit(5)
        .abortSignal(signal),
    ) as Order[],
  );
}

export async function orderByCode(businessId: string, code: string): Promise<Order | null> {
  return callWithRetry(async (signal) => {
    const rows = unwrap(
      await supabase
        .from('orders')
        .select(ORDER_COLS)
        .eq('business_id', businessId)
        .eq('order_code', code.trim().toUpperCase())
        .limit(1)
        .abortSignal(signal),
    ) as Order[];
    return rows[0] ?? null;
  });
}

export async function assignEvent(eventId: string, orderId: string): Promise<string> {
  return callWithRetry(async (signal) =>
    unwrap(await supabase.rpc('assign_payment_event_v1', { p_event_id: eventId, p_order_id: orderId }).abortSignal(signal)) as string,
  );
}
