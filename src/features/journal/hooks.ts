import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useQueue } from '../offline/useQueue';
import { combineDay, nextCursor, sumDailySales } from './summary';
import { dailySalesRange, daySummary, listOrders, PAGE_SIZE } from './api';
import { monthStart } from '../../lib/time';

/** Tổng một ngày = server + đơn tiền mặt còn trên máy. */
export function useDayTotals(businessId: string, day: string) {
  // Chọn cả mảng (tham chiếu ổn định) rồi lọc trong useMemo — lọc trong selector tạo mảng mới mỗi lần render
  const items = useQueue((s) => s.items);
  const q = useQuery({ queryKey: ['day', businessId, day], queryFn: () => daySummary(businessId, day) });
  const totals = useMemo(
    () => combineDay(day, q.data ?? [], items.filter((x) => x.businessId === businessId)),
    [day, q.data, items, businessId],
  );
  return { ...q, totals };
}

export function useDayOrders(businessId: string, day: string) {
  return useInfiniteQuery({
    queryKey: ['orders', businessId, day],
    initialPageParam: undefined as { soldAt: string; id: string } | undefined,
    queryFn: ({ pageParam }) => listOrders(businessId, day, pageParam),
    getNextPageParam: (last) => nextCursor(last, PAGE_SIZE),
  });
}

export function useMonthTotal(businessId: string, day: string) {
  return useQuery({
    queryKey: ['day', businessId, 'month', day.slice(0, 7)],
    queryFn: async () => sumDailySales(await dailySalesRange(businessId, monthStart(day), day)),
  });
}
