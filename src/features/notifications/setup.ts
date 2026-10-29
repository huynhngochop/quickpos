/**
 * Thông báo đẩy "tiền về" khi app ở nền. Kênh Android "payments" mức cao nhất, có âm thanh và rung.
 * Edge Function push-payment gửi với channelId "payments".
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ENV } from '../../lib/env';
import { vi } from '../../i18n/vi';

Notifications.setNotificationHandler({
  // App đang mở: đã đọc to + màn hình xanh, không cần hiện thêm banner
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensurePaymentChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('payments', {
    name: vi.notify.channelName,
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 120, 250],
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function notificationsGranted(): Promise<boolean> {
  const s = await Notifications.getPermissionsAsync();
  return s.granted;
}

export async function requestNotifications(): Promise<boolean> {
  await ensurePaymentChannel();
  const s = await Notifications.requestPermissionsAsync();
  return s.granted;
}

/** null khi chưa cho phép, chạy trên máy ảo, hoặc chưa cấu hình EAS project id. */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice || !ENV.easProjectId) return null;
  if (!(await notificationsGranted())) return null;
  try {
    const t = await Notifications.getExpoPushTokenAsync({ projectId: ENV.easProjectId });
    return t.data;
  } catch {
    return null;
  }
}

/** Màn "Bật báo tiền khi tắt màn hình": thử sau 10 giây. */
export async function scheduleTestNotification(title: string, body: string): Promise<void> {
  await ensurePaymentChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, channelId: 'payments' },
  });
}
