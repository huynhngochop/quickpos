import { useMutation, useQuery } from '@tanstack/react-query';
import { cancelOrder, confirmTransferManually, getOrder, qrForOrder } from './api';
import { applyOrderUpdate } from './realtime';
import type { Order } from '../../types/api';

export function useOrder(orderId: string | null) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getOrder(orderId!),
    enabled: !!orderId,
    // Lưới an toàn khi Realtime rớt mà không báo: hỏi lại mỗi 15 giây lúc đang chờ tiền
    refetchInterval: (q) => {
      const o = q.state.data as Order | undefined;
      return o && o.payment_status === 'UNPAID' ? 15_000 : false;
    },
  });
}

/** Khóa gồm số tiền còn thiếu: chuyển thiếu thì tự lấy mã mới cho phần còn lại. */
export function useQr(orderId: string | null, missing: number | null) {
  return useQuery({
    queryKey: ['qr', orderId, missing],
    queryFn: () => qrForOrder(orderId!),
    enabled: !!orderId && missing !== null && missing > 0,
    staleTime: Infinity,
  });
}

export function useCancelOrder() {
  return useMutation({ mutationFn: cancelOrder, onSuccess: applyOrderUpdate });
}

export function useManualConfirm() {
  return useMutation({
    mutationFn: (a: { orderId: string; note: string | null }) => confirmTransferManually(a.orderId, a.note),
    onSuccess: applyOrderUpdate,
  });
}
