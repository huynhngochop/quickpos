/**
 * Nhắc hàng sắp hết hạn: thông báo trên máy lúc 8 giờ sáng mỗi ngày khi còn lô sắp/đã hết hạn.
 * Mở app là đặt lại theo số liệu mới; hết lô cần xem thì hủy nhắc. Không gửi gì lên máy chủ.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { notificationsGranted } from './setup';
import { vi } from '../../i18n/vi';

const ID = 'expiry-reminder';
const CHANNEL = 'reminders';

export async function syncExpiryReminder(expiringLots: number): Promise<void> {
  try {
    if (!(await notificationsGranted())) return;
    await Notifications.cancelScheduledNotificationAsync(ID);
    if (expiringLots <= 0) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: vi.catalog.expiryNotifyTitle,
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: { title: vi.catalog.expiryNotifyTitle, body: vi.catalog.expiryNotifyBody, data: { url: '/hang-hoa?filter=EXPIRY' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 8, minute: 0, channelId: CHANNEL },
    });
  } catch {
    // Nhắc chỉ là phụ: lỗi thì thôi, cảnh báo vẫn hiện trong app
  }
}
