/**
 * Một kênh Realtime cho mỗi quán (docs/api.md mục 5). Realtime chỉ để cập nhật giao diện:
 * khi nối lại hoặc app trở lại từ nền, hỏi lại trạng thái đơn đang chờ từ DB.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../../lib/supabase';
import { queryClient } from '../../lib/queryClient';
import { deviceIdOrNull } from '../../lib/device';
import { usePrefs } from '../settings/prefs';
import { useSale } from './store';
import { announcement, paymentView } from './paymentState';
import { announce } from './announce';
import { getOrder } from './api';
import type { Order } from '../../types/api';

/** Áp dòng đơn mới vào cache và báo tiền nếu cần. Dùng chung cho Realtime và lần hỏi lại. */
export function applyOrderUpdate(next: Order): void {
  const prev = queryClient.getQueryData<Order>(['order', next.id]) ?? null;
  queryClient.setQueryData(['order', next.id], next);
  const deviceId = deviceIdOrNull();
  const text = deviceId ? announcement(prev, next, deviceId, usePrefs.getState().speak) : null;
  if (text) announce(text, paymentView(next));
  if (prev?.payment_status !== next.payment_status || prev?.amount_received !== next.amount_received) {
    void queryClient.invalidateQueries({ queryKey: ['day', next.business_id] });
    void queryClient.invalidateQueries({ queryKey: ['orders', next.business_id] });
  }
}

async function recheckActiveOrder(): Promise<void> {
  const id = useSale.getState().activeOrderId;
  if (!id) return;
  try {
    applyOrderUpdate(await getOrder(id));
  } catch {
    /* mất mạng: lần sau hỏi lại */
  }
}

export function useBusinessRealtime(businessId: string | null): void {
  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`business:${businessId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `business_id=eq.${businessId}` },
        (payload) => applyOrderUpdate(payload.new as Order),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void recheckActiveOrder();
      });

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void recheckActiveOrder();
    });
    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [businessId]);
}
