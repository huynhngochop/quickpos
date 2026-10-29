import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { colors, space } from '../theme/tokens';
import { Txt } from './Txt';
import { Button } from './Button';
import { Card } from './Screen';
import { vi } from '../i18n/vi';
import { toAppError } from '../lib/errors';
import { ENV } from '../lib/env';
import { useNet } from '../lib/net';

export function Loading({ label = vi.common.loading }: { label?: string }) {
  return (
    <View style={{ padding: space.xl, alignItems: 'center', gap: space.md }} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.primary} />
      <Txt tone="secondary">{label}</Txt>
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = toAppError(error);
  return (
    <Card tone="warn">
      <Txt variant="bodyStrong" tone="warn" accessibilityLiveRegion="assertive">
        {e.message}
      </Txt>
      {/* Bản dùng thử: hiện chi tiết kỹ thuật nhỏ để báo lỗi dễ hơn (bản thật không hiện) */}
      {ENV.demo && e.detail ? (
        <Txt variant="caption" tone="secondary" selectable>
          {e.detail}
        </Txt>
      ) : null}
      {onRetry ? <Button kind="secondary" label={vi.common.retry} onPress={onRetry} /> : null}
    </Card>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ padding: space.xl }}>
      <Txt tone="secondary" center>
        {text}
      </Txt>
    </View>
  );
}

/** Dải báo mất mạng ở đầu màn hình — chữ kèm màu, không chỉ màu. */
export function OfflineBanner({ queued = 0 }: { queued?: number }) {
  const online = useNet((s) => s.online);
  if (online) return null;
  return (
    <Card tone="warn" style={{ padding: 12 }}>
      <Txt variant="bodyStrong" tone="warn">
        {vi.offline.title}
      </Txt>
      <Txt variant="small" tone="warn">
        {vi.offline.body}
      </Txt>
      {queued > 0 ? (
        <Txt variant="small" tone="warn">
          {vi.offline.queued(queued)}
        </Txt>
      ) : null}
    </Card>
  );
}

/** Dải báo bản dùng thử (chỉ hiện khi chưa nối máy chủ thật). */
export function DemoBanner({ login }: { login?: boolean }) {
  if (!ENV.demo) return null;
  return (
    <Card tone="info" style={{ padding: 12 }}>
      <Txt variant="bodyStrong" tone="primary">
        {vi.common.demoTitle}
      </Txt>
      <Txt variant="small" tone="primary">
        {login ? vi.common.demoLogin : vi.common.demoBody}
      </Txt>
    </Card>
  );
}

export function callSupport(): void {
  if (ENV.supportPhone) void Linking.openURL(`tel:${ENV.supportPhone.replace(/\s/g, '')}`);
}

export function SupportLink({ label = vi.common.callSupport }: { label?: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={callSupport} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Txt variant="bodyStrong" tone="primary" center>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Toggle({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, paddingVertical: 10 }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        {hint ? (
          <Txt variant="small" tone="secondary">
            {hint}
          </Txt>
        ) : null}
      </View>
      <View
        style={{
          width: 76,
          height: 42,
          borderRadius: 21,
          backgroundColor: disabled ? colors.disabledBg : value ? colors.success : colors.toggleOff,
          flexDirection: value ? 'row' : 'row-reverse',
          alignItems: 'center',
          paddingHorizontal: 5,
          gap: 6,
        }}
      >
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface }} />
        <Txt variant="caption" tone="onColor" style={{ fontWeight: '800' }} maxFontSizeMultiplier={1}>
          {value ? vi.settings.on : vi.settings.off}
        </Txt>
      </View>
    </Pressable>
  );
}

export function Checkbox({ label, value, onChange, tone = 'primary' }: { label: string; value: boolean; onChange: (v: boolean) => void; tone?: 'primary' | 'danger' }) {
  const accent = tone === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 64,
        backgroundColor: colors.surface,
        borderWidth: value ? 3 : 2,
        borderColor: value ? accent : colors.ink,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: value ? accent : colors.ink,
          backgroundColor: value ? accent : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {value ? (
          <Txt tone="onColor" variant="bodyStrong" maxFontSizeMultiplier={1}>
            ✓
          </Txt>
        ) : null}
      </View>
      <Txt variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </Txt>
    </Pressable>
  );
}
