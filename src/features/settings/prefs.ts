/** Cài đặt trên máy này (không đồng bộ lên server trừ "đọc to", gửi qua register_device_v1). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type FontChoice = 'lg' | 'xl';

interface Prefs {
  speak: boolean;
  fontChoice: FontChoice;
  batteryDone: boolean;
  /** Mở khóa bằng PIN chủ quán đến thời điểm này (chỉ trong bộ nhớ, không lưu) */
  ownerUnlockedUntil: number;
  set: (p: Partial<Omit<Prefs, 'set'>>) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      speak: true,
      fontChoice: 'lg',
      batteryDone: false,
      ownerUnlockedUntil: 0,
      set: (p) => set(p),
    }),
    {
      name: 'quickpos.prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ speak: s.speak, fontChoice: s.fontChoice, batteryDone: s.batteryDone }),
    },
  ),
);

/** Hệ số cỡ chữ của app, nhân thêm trên cỡ chữ hệ thống */
export function fontFactor(choice: FontChoice): number {
  return choice === 'xl' ? 1.2 : 1;
}

export const OWNER_UNLOCK_MS = 5 * 60_000;
