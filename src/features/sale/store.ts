/**
 * Số đang nhập và đơn đang chờ — để NGOÀI component để gập/mở máy, xoay màn hình,
 * đổi bố cục một cột ↔ hai cột không làm mất (CLAUDE.md, mục bố cục).
 */
import { create } from 'zustand';
import { pressKey, digitsToAmount, type KeypadKey } from '../../lib/money';

interface SaleState {
  digits: string;
  /** Mã đơn VietQR đang chờ khách trả (null = chưa tạo) */
  activeOrderId: string | null;
  /** Mã đơn sinh sẵn cho lần bấm "Hiện mã QR" tiếp theo — giữ nguyên khi thử lại */
  pendingOrderId: string | null;
  press: (k: KeypadKey) => void;
  setActive: (id: string | null) => void;
  setPending: (id: string | null) => void;
  newSale: () => void;
}

export const useSale = create<SaleState>((set) => ({
  digits: '',
  activeOrderId: null,
  pendingOrderId: null,
  press: (k) => set((s) => ({ digits: pressKey(s.digits, k), pendingOrderId: null })),
  setActive: (id) => set({ activeOrderId: id }),
  setPending: (id) => set({ pendingOrderId: id }),
  newSale: () => set({ digits: '', activeOrderId: null, pendingOrderId: null }),
}));

export function useAmount(): number {
  return digitsToAmount(useSale((s) => s.digits));
}

/** Một dòng "Bán hàng" khi không dùng danh mục sản phẩm (docs/api.md mục 3). */
export function quickItems(amount: number) {
  return [{ name: 'Bán hàng', quantity: 1, unit_price: amount }];
}
