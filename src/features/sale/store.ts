/**
 * Số đang nhập, giỏ món, khách quen và đơn đang chờ — để NGOÀI component để gập/mở máy, xoay màn hình,
 * đổi bố cục một cột ↔ hai cột không làm mất (CLAUDE.md, mục bố cục).
 */
import { create } from 'zustand';
import { pressKey, digitsToAmount, type KeypadKey } from '../../lib/money';
import type { OrderInput, OrderItemInput } from '../../types/api';
import { orderPayload, type PromoResult } from '../promo/engine';

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  categoryId?: string | null;
}

interface SaleState {
  digits: string;
  /** Giỏ món (màn "Chọn món"). Bấm bàn phím số → bỏ giỏ, dùng số tự nhập. */
  cart: CartLine[];
  /** Giá sau khuyến mãi / giảm tay của giỏ (null = không có giảm, dùng giỏ nguyên giá) */
  pricing: PromoResult | null;
  /** Khách quen gắn vào đơn (tích điểm) */
  customer: { id: string; name: string; points: number } | null;
  /** Mã đơn VietQR đang chờ khách trả (null = chưa tạo) */
  activeOrderId: string | null;
  /** Mã đơn sinh sẵn cho lần bấm "Hiện mã QR" tiếp theo — giữ nguyên khi thử lại */
  pendingOrderId: string | null;
  press: (k: KeypadKey) => void;
  setCart: (lines: CartLine[], pricing?: PromoResult | null) => void;
  setCustomer: (c: SaleState['customer']) => void;
  setActive: (id: string | null) => void;
  setPending: (id: string | null) => void;
  newSale: () => void;
}

export const cartTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0);

export const useSale = create<SaleState>((set) => ({
  digits: '',
  cart: [],
  pricing: null,
  customer: null,
  activeOrderId: null,
  pendingOrderId: null,
  press: (k) => set((s) => ({ digits: pressKey(s.digits, k), cart: [], pricing: null, pendingOrderId: null })),
  setCart: (lines, pricing = null) => {
    const clean = lines.filter((l) => l.qty > 0);
    const total = pricing ? pricing.total : cartTotal(clean);
    set({ cart: clean, pricing: clean.length ? pricing : null, digits: total > 0 ? String(total) : '', pendingOrderId: null });
  },
  setCustomer: (c) => set({ customer: c }),
  setActive: (id) => set({ activeOrderId: id }),
  setPending: (id) => set({ pendingOrderId: id }),
  newSale: () => set({ digits: '', cart: [], pricing: null, customer: null, activeOrderId: null, pendingOrderId: null }),
}));

export function useAmount(): number {
  return digitsToAmount(useSale((s) => s.digits));
}

/** Một dòng "Bán hàng" khi không dùng danh mục sản phẩm (docs/api.md mục 3). */
export function quickItems(amount: number) {
  return [{ name: 'Bán hàng', quantity: 1, unit_price: amount }];
}

/** Dòng hàng gửi lên server: giỏ món nếu tổng khớp số đang hiện, không thì một dòng "Bán hàng". */
export function saleItems(amount: number, cart: CartLine[]): OrderItemInput[] {
  if (cart.length > 0 && cartTotal(cart) === amount) {
    return cart.map((l) => ({ name: l.name, quantity: l.qty, unit_price: l.unitPrice, product_id: l.productId }));
  }
  return quickItems(amount);
}

/** Như saleItems nhưng kèm khuyến mãi / giảm tay của giỏ (khi tổng sau giảm khớp số đang hiện). */
export function saleOrder(amount: number, cart: CartLine[], pricing: PromoResult | null): OrderInput {
  if (pricing && cart.length > 0 && pricing.total === amount) return orderPayload(pricing);
  return { items: saleItems(amount, cart), discount_amount: 0, promotion_id: null };
}
