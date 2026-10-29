import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ErrorView } from '../src/components/States';
import { sendOtp, verifyOtp } from '../src/features/session/api';
import { formatPhoneVN } from '../src/lib/money';
import { formatElapsed } from '../src/lib/time';
import { toAppError } from '../src/lib/errors';
import { colors, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

const RESEND_SECONDS = 60;

/** 1.2 Nhập mã 6 số. Một ô nhập ẩn nhận cả mã tự điền từ tin nhắn; 6 ô hiển thị chỉ để nhìn. */
export default function MaOTP() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [wrong, setWrong] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (value = code) => {
    if (value.length !== 6 || !phone) return;
    setBusy(true);
    setError(null);
    setWrong(false);
    try {
      await verifyOtp(phone, value);
      router.replace('/');
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'NETWORK') setError(err);
      else setWrong(true);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!phone) return;
    setWait(RESEND_SECONDS);
    try {
      await sendOtp(phone);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Screen back={{ label: vi.common.back }} footer={<Txt tone="secondary" center>{vi.otp.footer}</Txt>}>
      <Txt variant="heading">{vi.otp.title}</Txt>
      <Txt tone="secondary">{vi.otp.sentTo(formatPhoneVN(phone ?? ''))}</Txt>

      <Pressable onPress={() => input.current?.focus()} accessibilityLabel={vi.otp.codeLabel} style={{ flexDirection: 'row', gap: space.sm }}>
        {Array.from({ length: 6 }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 68,
              borderRadius: radius.sm,
              borderWidth: 2,
              borderColor: i === code.length ? colors.primary : colors.ink,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt variant="heading" maxFontSizeMultiplier={1.3}>
              {code[i] ?? ''}
            </Txt>
          </View>
        ))}
      </Pressable>
      <TextInput
        ref={input}
        value={code}
        onChangeText={(t) => {
          const v = t.replace(/[^0-9]/g, '').slice(0, 6);
          setCode(v);
          if (v.length === 6) void submit(v);
        }}
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        accessibilityLabel={vi.otp.codeLabel}
        testID="otp-input"
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />

      {error ? <ErrorView error={error} /> : null}
      {wrong ? (
        <Txt tone="danger" variant="bodyStrong" accessibilityLiveRegion="assertive">
          {vi.otp.wrong}
        </Txt>
      ) : null}
      <Button big label={vi.otp.continue} onPress={() => submit()} busy={busy} disabled={code.length !== 6} />

      <View style={{ alignItems: 'center', gap: 6 }}>
        <Txt tone="secondary">{vi.otp.notReceived}</Txt>
        {wait > 0 ? (
          <Txt variant="bodyStrong" tone="secondary">
            {vi.otp.resendIn(formatElapsed(wait))}
          </Txt>
        ) : (
          <Button kind="link" label={vi.otp.resend} onPress={resend} />
        )}
      </View>
    </Screen>
  );
}
