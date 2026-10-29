import { supabase } from '../../lib/supabase';
import { callWithRetry, unwrap } from '../../lib/retry';
import { vnDayRange } from '../../lib/time';
import type { DailySalesRow, DaySummaryRow, Order } from '../../types/api';

export const PAGE_SIZE = 20;

export async function daySummary(businessId: string, day: string): Promise<DaySummaryRow[]> {
  return callWithRetry(async (signal) =>
    unwrap(await supabase.rpc('day_summary', { p_business_id: businessId, p_day: day }).abortSignal(signal)) as DaySummaryRow[],
  );
}

/** Phân trang keyset — không dùng offset (docs/api.md mục 4). */
export async function listOrders(
  businessId: string,
  day: string,
  cursor?: { soldAt: string; id: string },
): Promise<Order[]> {
  const { from, to } = vnDayRange(day);
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('list_orders', {
          p_business_id: businessId,
          p_from: from,
          p_to: to,
          p_after_sold_at: cursor?.soldAt ?? null,
          p_after_id: cursor?.id ?? null,
          p_limit: PAGE_SIZE,
        })
        .abortSignal(signal),
    ) as Order[],
  );
}

export async function dailySalesRange(businessId: string, fromDay: string, toDay: string): Promise<DailySalesRow[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('daily_sales')
        .select('business_id, sale_date, method, orders_count, amount')
        .eq('business_id', businessId)
        .gte('sale_date', fromDay)
        .lte('sale_date', toDay)
        .abortSignal(signal),
    ) as DailySalesRow[],
  );
}
