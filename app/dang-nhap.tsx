import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { DemoBanner, ErrorView, callSupport } from '../src/components/States';
import { sendOtp } from '../src/features/session/api';
import { useSession } from '../src/features/session/store';
import { toE164VN } from '../src/lib/money';
import { ENV } from '../src/lib/env';
import { colors, font, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 1.1 Đăng nhập bằng số điện thoại (canvas DangNhap) */
export default function DangNhap() {
  const params = useLocalSearchParams<{ phone?: string }>();
  const [phone, setPhone] = useState(params.phone ?? '');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    const e164 = toE164VN(phone);
    setInvalid(!e164);
    if (!e164) return;
    setBusy(true);
    setError(null);
    try {
      await sendOtp(e164);
      useSession.getState().set({ lastPhone: e164 });
      router.push({ pathname: '/ma-otp', params: { phone: e164 } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <Card>
          <Txt variant="bodyStrong">{vi.login.helpTitle}</Txt>
          <Txt variant="small" tone="secondary">
            {vi.login.helpBody}
          </Txt>
          {ENV.supportPhone ? <Button kind="secondary" label={vi.login.call(ENV.supportPhone)} onPress={callSupport} /> : null}
        </Card>
      }
    >
      <Txt variant="title" tone="primary" style={{ marginTop: space.lg }}>
        {vi.appName}
      </Txt>
      <DemoBanner login />
      <Txt variant="heading">{vi.login.title}</Txt>
      <Txt tone="secondary">{vi.login.body}</Txt>
      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Txt variant="bodyStrong" nativeID="phoneLabel">
          {vi.login.phoneLabel}
        </Txt>
        <TextInput
          accessibilityLabelledBy="phoneLabel"
          testID="phone-input"
          value={phone}
          onChangeText={(t) => {
            setPhone(t);
            setInvalid(false);
          }}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder="0903 456 789"
          placeholderTextColor={colors.secondary}
          returnKeyType="done"
          onSubmitEditing={submit}
          maxLength={15}
          style={{
            height: 68,
            borderRadius: radius.md,
            borderWidth: 2,
            borderColor: invalid ? colors.danger : colors.ink,
            backgroundColor: colors.surface,
            paddingHorizontal: 16,
            fontSize: font.size.amountSmall - 4,
            fontFamily: font.family.bold,
            color: colors.ink,
          }}
        />
        {invalid ? (
          <Txt tone="danger" accessibilityLiveRegion="polite">
            {vi.login.phoneInvalid}
          </Txt>
        ) : null}
      </View>
      {error ? <ErrorView error={error} /> : null}
      <Button big label={vi.login.send} onPress={submit} busy={busy} />
    </Screen>
  );
}
