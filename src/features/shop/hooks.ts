import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import {
  currentShift, expiringLots, listCategories, listCustomers, listLots, listProducts, listStockCounts, listSuppliers, productSuppliers,
  stockCountDetail, stockReport, supplierBalances, supplierDetail,
} from './api';

export function useProducts(businessId: string, includeInactive = false) {
  return useQuery({ queryKey: ['products', businessId, includeInactive], queryFn: () => listProducts(businessId, includeInactive) });
}

export function useCustomers(businessId: string) {
  return useQuery({ queryKey: ['customers', businessId], queryFn: () => listCustomers(businessId) });
}

export function useCurrentShift(businessId: string) {
  return useQuery({ queryKey: ['shift', businessId], queryFn: () => currentShift(businessId), refetchInterval: 60_000 });
}

/** Lô hàng đã/sắp hết hạn (cảnh báo ở trang chính và Hàng hóa). Khóa bắt đầu bằng 'products' để làm mới cùng hàng hóa. */
export function useExpiringLots(businessId: string) {
  return useQuery({
    queryKey: ['products', businessId, 'expiring'],
    queryFn: () => expiringLots(businessId),
    enabled: !!businessId,
    staleTime: 5 * 60_000,
  });
}

export function useLots(productId: string) {
  return useQuery({ queryKey: ['lots', productId], queryFn: () => listLots(productId), enabled: !!productId });
}

export function useStockReport(businessId: string, from: string, to: string) {
  return useQuery({ queryKey: ['stock-report', businessId, from, to], queryFn: () => stockReport(businessId, from, to) });
}

/**
 * Kết quả màn /quet-ma. Chế độ "điền vào ô": `code` (màn trước đọc rồi xóa).
 * Chế độ "bán": quét liên tục, mỗi mã vào `queue`; màn Chọn món (vẫn mở bên dưới) lấy ra và thêm vào giỏ.
 */
export const useScanResult = create<{
  code: string | null;
  set: (c: string | null) => void;
  queue: string[];
  push: (c: string) => void;
  drain: () => string[];
}>((set, get) => ({
  code: null,
  set: (code) => set({ code }),
  queue: [],
  push: (c) => set((s) => ({ queue: [...s.queue, c] })),
  drain: () => {
    const q = get().queue;
    if (q.length) set({ queue: [] });
    return q;
  },
}));

/** Số lượng hiển thị: số nguyên không có phần lẻ, số lẻ dùng dấu phẩy (1,5 kg). */
export function formatQty(q: number): string {
  const r = Math.round(q * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}

// ---------- Migration 9 ----------
/** Khóa bắt đầu bằng 'products' để làm mới cùng hàng hóa sau mỗi lần ghi */
export function useCategories(businessId: string) {
  return useQuery({ queryKey: ['products', businessId, 'categories'], queryFn: () => listCategories(businessId), enabled: !!businessId, staleTime: 60_000 });
}
export function useSuppliers(businessId: string) {
  return useQuery({ queryKey: ['suppliers', businessId], queryFn: () => listSuppliers(businessId), enabled: !!businessId, staleTime: 60_000 });
}
export function useSupplierBalances(businessId: string) {
  return useQuery({ queryKey: ['suppliers', businessId, 'balances'], queryFn: () => supplierBalances(businessId), enabled: !!businessId });
}
export function useSupplierDetail(businessId: string, supplierId: string) {
  return useQuery({ queryKey: ['suppliers', businessId, 'detail', supplierId], queryFn: () => supplierDetail(supplierId), enabled: !!supplierId });
}
export function useProductSuppliers(businessId: string, productId: string) {
  return useQuery({ queryKey: ['suppliers', businessId, 'product', productId], queryFn: () => productSuppliers(productId), enabled: !!productId });
}
export function useStockCounts(businessId: string) {
  return useQuery({ queryKey: ['products', businessId, 'counts'], queryFn: () => listStockCounts(businessId), enabled: !!businessId });
}
export function useStockCountDetail(businessId: string, countId: string) {
  return useQuery({ queryKey: ['products', businessId, 'count', countId], queryFn: () => stockCountDetail(countId), enabled: !!countId });
}
