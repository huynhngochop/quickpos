/**
 * Tính khuyến mãi cho giỏ hàng (thuần, không gọi mạng; chạy trên máy bán).
 * - Giảm giá món (ITEM_DISCOUNT): theo món hoặc cả danh mục, % hoặc số tiền mỗi đơn vị. Mỗi dòng lấy mức giảm có lợi nhất cho khách.
 * - Mua X tặng Y (BUY_X_GET_Y): đủ X thì thêm dòng tặng giá 0 (trừ kho như bán, không tính doanh thu).
 * - Giảm trên tổng đơn (ORDER_DISCOUNT): đơn (sau giảm món) từ mức tối thiểu; lấy chương trình giảm nhiều nhất.
 * Giảm tay (thu ngân gõ) cộng sau cùng, không vượt số còn lại.
 */
export type PromoKind = 'ITEM_DISCOUNT' | 'BUY_X_GET_Y' | 'ORDER_DISCOUNT';

export interface Promotion {
  id: string;
  name: string;
  kind: PromoKind;
  product_id: string | null;
  category_id: string | null;
  percent: number | null;
  amount: number | null;
  buy_qty: number | null;
  get_qty: number | null;
  get_product_id: string | null;
  min_total: number | null;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  archived_at?: string | null;
}

export interface CartLine {
  product_id: string | null;
  category_id?: string | null;
  name: string;
  quantity: number;
  unit_price: number;
}

export interface PricedLine extends CartLine {
  discount_amount: number;
  promotion_id: string | null;
  is_gift: boolean;
  line_amount: number;
}

export interface PromoResult {
  lines: PricedLine[];
  subtotal: number;
  itemDiscount: number;
  orderDiscount: { amount: number; promotion_id: string | null; name: string | null };
  manualDiscount: number;
  total: number;
  /** Chương trình đã áp: để hiện "Đã giảm 10.000 đ — Giảm cuối tuần" */
  applied: { promotion_id: string; name: string; amount: number; gift?: { name: string; quantity: number } }[];
}

export const isRunning = (p: Promotion, today: string) =>
  p.is_active && !p.archived_at && (!p.starts_on || p.starts_on <= today) && (!p.ends_on || p.ends_on >= today);

function valueOff(p: Promotion, base: number): number {
  if (p.percent != null) return Math.round((base * p.percent) / 100);
  return Math.min(p.amount ?? 0, base);
}

/**
 * products: tra tên / giá / danh mục món tặng. manual: số tiền giảm tay (đã được phép) trên phần còn lại.
 */
export function applyPromotions(
  cart: CartLine[],
  promos: Promotion[],
  today: string,
  products: Map<string, { name: string; price: number; category_id: string | null }>,
  manual = 0,
): PromoResult {
  const live = promos.filter((p) => isRunning(p, today));
  const applied: PromoResult['applied'] = [];
  const lines: PricedLine[] = cart.map((l) => {
    const gross = Math.round(l.quantity * l.unit_price);
    let best: { p: Promotion; off: number } | null = null;
    for (const p of live) {
      if (p.kind !== 'ITEM_DISCOUNT' || !l.product_id) continue;
      const hit = p.product_id ? p.product_id === l.product_id : !!p.category_id && p.category_id === (l.category_id ?? products.get(l.product_id)?.category_id);
      if (!hit) continue;
      // Số tiền giảm tính theo mỗi đơn vị
      const off = Math.min(p.percent != null ? valueOff(p, gross) : Math.round((p.amount ?? 0) * l.quantity), gross);
      if (off > 0 && (!best || off > best.off)) best = { p, off };
    }
    if (best) applied.push({ promotion_id: best.p.id, name: best.p.name, amount: best.off });
    return { ...l, discount_amount: best?.off ?? 0, promotion_id: best?.p.id ?? null, is_gift: false, line_amount: gross - (best?.off ?? 0) };
  });

  // Mua X tặng Y: cộng số lượng cùng món trên các dòng
  const qtyOf = new Map<string, number>();
  for (const l of cart) if (l.product_id) qtyOf.set(l.product_id, (qtyOf.get(l.product_id) ?? 0) + l.quantity);
  for (const p of live) {
    if (p.kind !== 'BUY_X_GET_Y' || !p.product_id || !p.buy_qty || !p.get_qty) continue;
    const times = Math.floor((qtyOf.get(p.product_id) ?? 0) / p.buy_qty);
    const giftId = p.get_product_id ?? p.product_id;
    const gift = products.get(giftId);
    if (times <= 0 || !gift) continue;
    const quantity = times * p.get_qty;
    lines.push({ product_id: giftId, category_id: gift.category_id, name: gift.name, quantity, unit_price: 0, discount_amount: 0,
      promotion_id: p.id, is_gift: true, line_amount: 0 });
    applied.push({ promotion_id: p.id, name: p.name, amount: Math.round(quantity * gift.price), gift: { name: gift.name, quantity } });
  }

  const subtotal = lines.reduce((t, l) => t + l.line_amount, 0);
  const itemDiscount = lines.reduce((t, l) => t + l.discount_amount, 0);
  let order: PromoResult['orderDiscount'] = { amount: 0, promotion_id: null, name: null };
  for (const p of live) {
    if (p.kind !== 'ORDER_DISCOUNT' || subtotal < (p.min_total ?? 0) || subtotal <= 0) continue;
    const off = Math.min(valueOff(p, subtotal), subtotal);
    if (off > order.amount) order = { amount: off, promotion_id: p.id, name: p.name };
  }
  if (order.promotion_id) applied.push({ promotion_id: order.promotion_id, name: order.name!, amount: order.amount });
  const manualDiscount = Math.max(0, Math.min(Math.round(manual), subtotal - order.amount));
  return {
    lines, subtotal, itemDiscount, orderDiscount: order, manualDiscount,
    total: subtotal - order.amount - manualDiscount, applied,
  };
}

/** Tham số gửi lên create_order_v1 / create_cash_sale_v1 từ kết quả tính */
export function orderPayload(r: PromoResult): {
  items: { product_id: string | null; name: string; quantity: number; unit_price: number; discount_amount: number; promotion_id: string | null; is_gift: boolean }[];
  discount_amount: number;
  promotion_id: string | null;
} {
  return {
    items: r.lines.map((l) => ({ product_id: l.product_id, name: l.name, quantity: l.quantity, unit_price: l.unit_price,
      discount_amount: l.discount_amount, promotion_id: l.promotion_id, is_gift: l.is_gift })),
    discount_amount: r.orderDiscount.amount + r.manualDiscount,
    // Có giảm tay thì không gắn chương trình cho phần giảm cả đơn (máy chủ kiểm tra quyền giảm tay)
    promotion_id: r.manualDiscount > 0 ? null : r.orderDiscount.promotion_id,
  };
}
