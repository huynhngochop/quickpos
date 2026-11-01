import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dailySalesRange } from '../journal/api';
import { periodFor, totalsFor, type PeriodKey } from '../reports/period';
import { addDebtCustomer, addExpense, listDebtEntries, listDebtors, listExpenses, recordDebt, voidDebtEntry, voidExpense } from './api';
import { newId } from '../../lib/device';

/** Báo cáo một kỳ + kỳ trước để so sánh + chi phí trong kỳ. Đọc daily_sales (đã tổng sẵn), không cộng trên orders. */
export function usePeriodReport(businessId: string, key: PeriodKey, today: string) {
  const p = periodFor(key, today);
  const sales = useQuery({
    queryKey: ['day', businessId, 'range', p.prevFrom < p.from ? p.prevFrom : p.from, p.to],
    queryFn: () => dailySalesRange(businessId, p.prevFrom < p.from ? p.prevFrom : p.from, p.to),
  });
  const expenses = useQuery({ queryKey: ['expenses', businessId, p.from, p.to], queryFn: () => listExpenses(businessId, p.from, p.to) });
  const data = useMemo(() => {
    if (!sales.data) return null;
    const now = totalsFor(sales.data, p.from, p.to);
    const prev = totalsFor(sales.data, p.prevFrom, p.prevTo);
    const expenseTotal = (expenses.data ?? []).reduce((s, e) => s + e.amount, 0);
    const expensesByDay = new Map<string, number>();
    for (const e of expenses.data ?? []) expensesByDay.set(e.entry_date, (expensesByDay.get(e.entry_date) ?? 0) + e.amount);
    return { period: p, now, prev, expenseTotal, expensesByDay, profit: now.revenue - expenseTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales.data, expenses.data, p.from, p.to, p.prevFrom, p.prevTo]);
  return { sales, expenses, data };
}

export function useExpenses(businessId: string, from: string, to: string) {
  return useQuery({ queryKey: ['expenses', businessId, from, to], queryFn: () => listExpenses(businessId, from, to) });
}

export function useAddExpense(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Mã sinh một lần cho mỗi lần bấm "Lưu": bấm lại khi mạng chập chờn không ghi trùng
    mutationFn: (v: { entryId?: string; amount: number; category: string; note?: string }) =>
      addExpense({ entryId: v.entryId ?? newId(), businessId, amount: v.amount, category: v.category, note: v.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses', businessId] }),
  });
}

export function useVoidExpense(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => voidExpense(businessId, entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses', businessId] }),
  });
}

export function useDebtors(businessId: string) {
  return useQuery({ queryKey: ['debts', businessId], queryFn: () => listDebtors(businessId) });
}

export function useDebtEntries(customerId: string) {
  return useQuery({ queryKey: ['debts', 'entries', customerId], queryFn: () => listDebtEntries(customerId) });
}

export function useAddDebtor(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { customerId: string; name: string; phone?: string; phoneConsent: boolean }) => addDebtCustomer({ ...v, businessId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debts', businessId] }),
  });
}

export function useRecordDebt(businessId: string, customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { entryId: string; kind: 'DEBT' | 'PAYMENT'; amount: number; note?: string }) => recordDebt({ ...v, customerId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['debts', businessId] });
      void qc.invalidateQueries({ queryKey: ['debts', 'entries', customerId] });
    },
  });
}

export function useVoidDebtEntry(businessId: string, customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => voidDebtEntry(entryId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['debts', businessId] });
      void qc.invalidateQueries({ queryKey: ['debts', 'entries', customerId] });
    },
  });
}
