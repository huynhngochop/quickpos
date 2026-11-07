import { useState } from 'react';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ConfirmSheet } from '../src/components/ConfirmSheet';
import { ErrorView } from '../src/components/States';
import { useBusinessId, useSession } from '../src/features/session/store';
import { applyBackup, pickBackup, shareBackup } from '../src/features/backup/api';
import { lastBackupAt } from '../src/lib/localStore';
import { queryClient } from '../src/lib/queryClient';
import { formatDateVN, formatTimeVN } from '../src/lib/time';
import { space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';
import type { BackupFile } from '../src/lib/demoClient';

const when = (iso: string) => `${formatTimeVN(iso)} ${formatDateVN(iso)}`;

/**
 * Sao lưu và khôi phục (chế độ lưu trên máy). Mở từ Cài đặt (sau PIN chủ quán) hoặc từ bước tạo quán
 * khi cài trên máy mới (chưa có quán → chỉ hiện phần khôi phục).
 */
export default function SaoLuu() {
  const businessId = useBusinessId();
  const hasShop = !!useSession((s) => s.business?.id);
  const [last, setLast] = useState(() => lastBackupAt());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [error, setError] = useState<unknown>(null);

  const backup = async () => {
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      const shared = await shareBackup(businessId);
      setLast(lastBackupAt());
      setMsg({ text: shared ? vi.local.backupDone : vi.local.restoreError, ok: shared });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    setMsg(null);
    setError(null);
    try {
      const f = await pickBackup();
      if (f) setPending(f);
    } catch (e) {
      setMsg({ text: e instanceof Error && e.message === 'BAD_FILE' ? vi.local.restoreBad : vi.local.restoreError, ok: false });
    }
  };

  const restore = () => {
    if (!pending) return;
    try {
      applyBackup(pending);
      setPending(null);
      queryClient.clear();
      // Cổng vào đọc lại quán của người đang đăng nhập (máy mới: hỏi đặt mã PIN chủ quán)
      router.replace('/');
    } catch (e) {
      setPending(null);
      setError(e);
    }
  };

  return (
    <Screen back={hasShop ? { label: vi.settings.title, href: '/cai-dat' } : { label: vi.common.back }} maxWidth={640}>
      <Txt variant="heading">{vi.local.title}</Txt>
      <Txt tone="secondary">{vi.local.body}</Txt>

      {hasShop ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="bodyStrong" tone={last ? 'success' : 'warn'}>
            {last ? vi.local.last(when(last)) : vi.local.lastNever}
          </Txt>
          <Txt tone="secondary">{vi.local.backupHint}</Txt>
          <Txt variant="small" tone="warn">
            {vi.local.backupPrivacy}
          </Txt>
          <Button big label={vi.local.backupNow} onPress={() => void backup()} busy={busy} />
        </Card>
      ) : null}

      {msg ? (
        <Card tone={msg.ok ? 'success' : 'warn'}>
          <Txt variant="bodyStrong" tone={msg.ok ? 'success' : 'warn'}>
            {msg.ok ? `✓ ${msg.text}` : msg.text}
          </Txt>
        </Card>
      ) : null}
      {error ? <ErrorView error={error} /> : null}

      <Card style={{ gap: space.md }}>
        <Txt variant="title">{vi.local.restoreTitle}</Txt>
        <Txt tone="secondary">{vi.local.restoreBody}</Txt>
        <Button kind={hasShop ? 'secondary' : 'primary'} big={!hasShop} label={vi.local.restorePick} onPress={() => void pick()} />
      </Card>

      <ConfirmSheet
        visible={!!pending}
        title={pending ? vi.local.restoreAsk(pending.business_name) : ''}
        body={pending ? vi.local.restoreAskBody(when(pending.created_at), pending.orders) : ''}
        yes={vi.local.restoreYes}
        no={vi.common.back}
        danger={hasShop}
        onYes={restore}
        onNo={() => setPending(null)}
      />
    </Screen>
  );
}
