/**
 * Số đang nhập, giỏ món, khách quen và đơn đang chờ — để NGOÀI component để gập/mở máy, xoay màn hình,
 * đổi bố cục một cột ↔ hai cột không làm mất (CLAUDE.md, mục bố cục).
 */
import { create } from 'zustand';
import { pressKey, digitsToAmount, type KeypadKey } from '../../lib/money';
import type { OrderItemInput } from '../../types/api';

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
}

interface SaleState {
  digits: string;
  /** Giỏ món (màn "Chọn món"). Bấm bàn phím số → bỏ giỏ, dùng số tự nhập. */
  cart: CartLine[];
  /** Khách quen gắn vào đơn (tích điểm) */
  customer: { id: string; name: string; points: number } | null;
  /** Mã đơn VietQR đang chờ khách trả (null = chưa tạo) */
  activeOrderId: string | null;
  /** Mã đơn sinh sẵn cho lần bấm "Hiện mã QR" tiếp theo — giữ nguyên khi thử lại */
  pendingOrderId: string | null;
  press: (k: KeypadKey) => void;
  setCart: (lines: CartLine[]) => void;
  setCustomer: (c: SaleState['customer']) => void;
  setActive: (id: string | null) => void;
  setPending: (id: string | null) => void;
  newSale: () => void;
}

export const cartTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0);

export const useSale = create<SaleState>((set) => ({
  digits: '',
  cart: [],
  customer: null,
  activeOrderId: null,
  pendingOrderId: null,
  press: (k) => set((s) => ({ digits: pressKey(s.digits, k), cart: [], pendingOrderId: null })),
  setCart: (lines) => {
    const clean = lines.filter((l) => l.qty > 0);
    const total = cartTotal(clean);
    set({ cart: clean, digits: total > 0 ? String(total) : '', pendingOrderId: null });
  },
  setCustomer: (c) => set({ customer: c }),
  setActive: (id) => set({ activeOrderId: id }),
  setPending: (id) => set({ pendingOrderId: id }),
  newSale: () => set({ digits: '', cart: [], customer: null, activeOrderId: null, pendingOrderId: null }),
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
