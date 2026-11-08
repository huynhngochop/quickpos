/** Khuyến mãi (migration 9, docs/api.md mục 9.2). Đọc bảng promotions; ghi qua upsert_promotion_v1 / archive_promotion_v1. */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { callWithRetry, unwrap } from '../../lib/retry';
import type { PromoKind, Promotion } from './engine';

const COLS = 'id, name, kind, product_id, category_id, percent, amount, buy_qty, get_qty, get_product_id, min_total, starts_on, ends_on, is_active';

export async function listPromotions(businessId: string): Promise<Promotion[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase.from('promotions').select(COLS).eq('business_id', businessId).is('archived_at', null)
        .order('created_at', { ascending: false }).abortSignal(signal),
    ) as Promotion[],
  );
}

export interface PromotionInput {
  promotionId: string;
  businessId: string;
  name: string;
  kind: PromoKind;
  productId?: string | null;
  categoryId?: string | null;
  percent?: number | null;
  amount?: number | null;
  buyQty?: number | null;
  getQty?: number | null;
  getProductId?: string | null;
  minTotal?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
  isActive: boolean;
}

export const upsertPromotion = (p: PromotionInput) =>
  callWithRetry(async (signal) =>
    unwrap(
      await supabase.rpc('upsert_promotion_v1', {
        p_promotion_id: p.promotionId, p_business_id: p.businessId, p_name: p.name, p_kind: p.kind,
        p_product_id: p.productId ?? null, p_category_id: p.categoryId ?? null, p_percent: p.percent ?? null, p_amount: p.amount ?? null,
        p_buy_qty: p.buyQty ?? null, p_get_qty: p.getQty ?? null, p_get_product_id: p.getProductId ?? null, p_min_total: p.minTotal ?? null,
        p_starts_on: p.startsOn ?? null, p_ends_on: p.endsOn ?? null, p_is_active: p.isActive,
      }).abortSignal(signal),
    ) as Promotion,
  );

export const archivePromotion = (promotionId: string) =>
  callWithRetry(async (signal) => unwrap(await supabase.rpc('archive_promotion_v1', { p_promotion_id: promotionId }).abortSignal(signal)) as Promotion);

export function usePromotions(businessId: string) {
  return useQuery({ queryKey: ['promotions', businessId], queryFn: () => listPromotions(businessId), enabled: !!businessId, staleTime: 60_000 });
}
