/**
 * Báo tiền về bằng 3 kênh cùng lúc: giọng đọc tiếng Việt, rung, cả màn hình xanh ≥ 3 giây.
 * Không dùng toast nhỏ tự tắt cho sự kiện tiền.
 */
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { Vibration } from 'react-native';
import { create } from 'zustand';
import { PAID_FLASH_MS } from '../../theme/tokens';
import type { PaymentView } from './paymentState';

export function speakVi(text: string): void {
  Speech.stop();
  Speech.speak(text, { language: 'vi-VN', rate: 0.92, pitch: 1.0 });
}

export function buzz(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  Vibration.vibrate([0, 250, 120, 250]);
}

interface FlashState {
  view: PaymentView | null;
  at: number;
  show: (v: PaymentView) => void;
  hide: () => void;
}

export const useFlash = create<FlashState>((set) => ({
  view: null,
  at: 0,
  show: (view) => {
    const at = Date.now();
    set({ view, at });
    setTimeout(() => {
      if (useFlash.getState().at === at) set({ view: null });
    }, PAID_FLASH_MS);
  },
  hide: () => set({ view: null }),
}));

export function announce(text: string, view: PaymentView): void {
  speakVi(text);
  buzz();
  useFlash.getState().show(view);
}
