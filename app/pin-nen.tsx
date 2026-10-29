import { Platform, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as IntentLauncher from 'expo-intent-launcher';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { notificationsGranted, requestNotifications, scheduleTestNotification } from '../src/features/notifications/setup';
import { usePrefs } from '../src/features/settings/prefs';
import { colors, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/**
 * 7.2 Bật báo tiền khi tắt màn hình. Android hay tự tắt app để tiết kiệm pin;
 * thông báo đẩy ưu tiên cao + bỏ tối ưu pin là cách để vẫn báo được.
 * App không đọc được trạng thái "tối ưu pin" mà không thêm thư viện → người dùng tự xác nhận đã chỉnh.
 */
export default function PinNen() {
  const qc = useQueryClient();
  const notif = useQuery({ queryKey: ['notifGranted'], queryFn: notificationsGranted });
  const batteryDone = usePrefs((s) => s.batteryDone);
  const set = usePrefs((s) => s.set);
  const isAndroid = Platform.OS === 'android';

  const steps = [
    {
      done: !!notif.data,
      title: vi.background.notifTitle,
      hint: vi.background.notifHint,
      action: vi.background.notifAction,
      fix: async () => {
        await requestNotifications();
        void qc.invalidateQueries({ queryKey: ['notifGranted'] });
      },
    },
    ...(isAndroid
      ? [
          {
            done: batteryDone,
            title: vi.background.batteryTitle,
            hint: vi.background.batteryHint,
            action: vi.background.batteryAction,
            fix: async () => {
              await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            },
            confirm: () => set({ batteryDone: true }),
          },
        ]
      : []),
  ];
  const left = steps.filter((s) => !s.done).length;

  return (
    <Screen
      back={{ label: vi.settings.title }}
      footer={
        <>
          <Button
            kind="secondary"
            label={vi.background.test}
            disabled={!notif.data}
            disabledLabel={vi.background.notifAction}
            onPress={() => void scheduleTestNotification(vi.background.testTitle, vi.background.testBody)}
          />
          <Txt variant="caption" tone="secondary" center>
            {vi.background.testHint}
          </Txt>
        </>
      }
    >
      <Txt variant="heading">{vi.background.title}</Txt>
      <Txt tone="secondary">{vi.background.body(left)}</Txt>
      {steps.map((s, i) => (
        <Card key={s.title} style={{ borderColor: s.done ? colors.border : colors.warn, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: s.done ? colors.success : colors.warn,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Txt variant="bodyStrong" tone="onColor" maxFontSizeMultiplier={1.2}>
                {s.done ? '✓' : String(i + 1)}
              </Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{s.title}</Txt>
              <Txt variant="small" tone={s.done ? 'success' : 'warn'}>
                {s.done ? vi.background.done : vi.background.todo}
              </Txt>
            </View>
          </View>
          <Txt variant="small" tone="secondary">
            {s.hint}
          </Txt>
          {!s.done ? <Button label={s.action} onPress={() => void s.fix()} /> : null}
          {!s.done && 'confirm' in s && s.confirm ? <Button kind="link" label={vi.background.batteryConfirm} onPress={s.confirm} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
