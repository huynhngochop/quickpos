import { useQuery } from '@tanstack/react-query';
import { currentShift, listCustomers, listProducts } from './api';

export function useProducts(businessId: string, includeInactive = false) {
  return useQuery({ queryKey: ['products', businessId, includeInactive], queryFn: () => listProducts(businessId, includeInactive) });
}

export function useCustomers(businessId: string) {
  return useQuery({ queryKey: ['customers', businessId], queryFn: () => listCustomers(businessId) });
}

export function useCurrentShift(businessId: string) {
  return useQuery({ queryKey: ['shift', businessId], queryFn: () => currentShift(businessId), refetchInterval: 60_000 });
}

/** Số lượng hiển thị: số nguyên không có phần lẻ, số lẻ dùng dấu phẩy (1,5 kg). */
export function formatQty(q: number): string {
  const r = Math.round(q * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}
