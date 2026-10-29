import { useState } from 'react';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { Checkbox, ErrorView } from '../src/components/States';
import { requestAccountDeletion, signOut } from '../src/features/session/api';
import { useSession } from '../src/features/session/store';
import { useQueue } from '../src/features/offline/useQueue';
import { clearOwnerPin } from '../src/features/settings/pinStore';
import { vi } from '../src/i18n/vi';

/** 7.6 Xóa tài khoản ngay trong app (yêu cầu của Google Play / App Store). */
export default function XoaTaiKhoan() {
  const role = useSession((s) => s.role);
  const queued = useQueue((s) => s.items.length);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const blocked = queued > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestAccountDeletion();
      await clearOwnerPin();
      useSession.getState().set({ everSignedIn: false, lastPhone: null });
      await signOut();
      useSession.getState().reset();
      router.replace('/dang-nhap');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      back={{ label: vi.settings.title }}
      footer={
        <>
          {error ? <ErrorView error={error} /> : null}
          <Button
            big
            kind="danger"
            label={vi.deletion.confirm}
            disabled={!sure || blocked}
            disabledLabel={blocked ? vi.deletion.queueBlocked : vi.deletion.needCheck}
            busy={busy}
            onPress={submit}
          />
          <Button kind="link" label={vi.deletion.cancel} onPress={() => router.back()} />
        </>
      }
    >
      <Txt variant="heading">{vi.deletion.title}</Txt>
      <Card>
        <Txt variant="bodyStrong" tone="danger">
          {vi.deletion.willDelete}
        </Txt>
        {vi.deletion.willDeleteItems.map((t) => (
          <Txt key={t}>{`• ${t}`}</Txt>
        ))}
      </Card>
      <Card>
        <Txt variant="bodyStrong">{vi.deletion.kept}</Txt>
        <Txt tone="secondary">{vi.deletion.keptBody}</Txt>
      </Card>
      {role === 'OWNER' ? (
        <Card tone="warn">
          <Txt variant="bodyStrong" tone="warn">
            {vi.deletion.ownerTitle}
          </Txt>
          <Txt tone="warn">{vi.deletion.ownerBody}</Txt>
        </Card>
      ) : null}
      <Txt variant="small" tone="secondary">
        {vi.deletion.timing}
      </Txt>
      <Checkbox label={vi.deletion.checkbox} value={sure} onChange={setSure} tone="danger" />
    </Screen>
  );
}
