import { useState } from 'react';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ErrorView } from '../src/components/States';
import { sendOtp } from '../src/features/session/api';
import { useSession } from '../src/features/session/store';
import { useQueue } from '../src/features/offline/useQueue';
import { formatPhoneVN } from '../src/lib/money';
import { space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 7.5 Hết phiên: gửi lại mã cho đúng số cũ, hàng đợi vẫn giữ. */
export default function HetPhien() {
  const phone = useSession((s) => s.lastPhone);
  const queued = useQueue((s) => s.items.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const resend = async () => {
    if (!phone) return router.replace('/dang-nhap');
    setBusy(true);
    setError(null);
    try {
      await sendOtp(phone);
      router.push({ pathname: '/ma-otp', params: { phone } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button big label={vi.session.sendNew} onPress={resend} busy={busy} />
          <Button kind="link" label={vi.session.otherPhone} onPress={() => router.replace('/dang-nhap')} />
        </>
      }
    >
      <Txt variant="heading" style={{ marginTop: space.lg }}>
        {vi.session.expiredTitle}
      </Txt>
      <Txt tone="secondary">{vi.session.expiredBody}</Txt>
      {queued > 0 ? (
        <Card tone="success">
          <Txt tone="success" variant="bodyStrong">
            {vi.session.queueKept(queued)}
          </Txt>
        </Card>
      ) : null}
      {phone ? (
        <Card>
          <Txt variant="small" tone="secondary">
            {vi.login.phoneLabel}
          </Txt>
          <Txt variant="title">{formatPhoneVN(phone)}</Txt>
        </Card>
      ) : null}
      {error ? <ErrorView error={error} /> : null}
    </Screen>
  );
}
