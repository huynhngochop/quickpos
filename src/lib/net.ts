/**
 * Trạng thái mạng: một nguồn cho cả app. Nối với TanStack Query (onlineManager) để
 * truy vấn tự dừng khi mất mạng và chạy lại khi có mạng.
 */
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { create } from 'zustand';

interface NetState {
  online: boolean;
}

export const useNet = create<NetState>(() => ({ online: true }));

let started = false;
export function startNetWatch(onReconnect: () => void): void {
  if (started) return;
  started = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) => {
      // isInternetReachable = null lúc đang kiểm tra: coi như có mạng, lời gọi lỗi sẽ tự vào hàng đợi
      const online = s.isConnected !== false && s.isInternetReachable !== false;
      const was = useNet.getState().online;
      useNet.setState({ online });
      setOnline(online);
      if (online && !was) onReconnect();
    }),
  );
}
