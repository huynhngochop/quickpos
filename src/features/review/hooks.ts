import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignEvent, candidateOrders, eventsNeedingReview, getEvent, orderByCode, unreconciledManual } from './api';

export function useReview(businessId: string, enabled: boolean) {
  const events = useQuery({ queryKey: ['review', businessId, 'events'], queryFn: () => eventsNeedingReview(businessId), enabled });
  const manual = useQuery({ queryKey: ['review', businessId, 'manual'], queryFn: () => unreconciledManual(businessId), enabled });
  const count = (events.data?.length ?? 0) + (manual.data?.length ?? 0);
  return { events, manual, count };
}

export function useEvent(eventId: string) {
  return useQuery({ queryKey: ['event', eventId], queryFn: () => getEvent(eventId) });
}

export function useCandidates(businessId: string, amount: number | undefined) {
  return useQuery({
    queryKey: ['candidates', businessId, amount],
    queryFn: () => candidateOrders(businessId, amount!),
    enabled: amount !== undefined,
  });
}

export function useOrderByCode(businessId: string, code: string) {
  const ok = /^[A-HJ-KMNP-Z2-9]{8}$/i.test(code.trim());
  return useQuery({ queryKey: ['orderByCode', businessId, code.toUpperCase()], queryFn: () => orderByCode(businessId, code), enabled: ok });
}

export function useAssign(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { eventId: string; orderId: string }) => assignEvent(a.eventId, a.orderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['review', businessId] });
      void qc.invalidateQueries({ queryKey: ['day', businessId] });
      void qc.invalidateQueries({ queryKey: ['orders', businessId] });
    },
  });
}
