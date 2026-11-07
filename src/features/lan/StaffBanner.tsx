import { useEffect, useState } from 'react';
import { Card } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { currentLanClient } from '../../lib/supabase';
import { logoutHere } from '../session/logout';
import { useQueue } from '../offline/useQueue';
import { space } from '../../theme/tokens';
import { vi } from '../../i18n/vi';

/** Máy nhân viên (gói Pro): đang nối máy chủ quán nào, có nối được không, nút ngắt kết nối. */
export function StaffBanner() {
  const client = currentLanClient();
  const [status, setStatus] = useState<'online' | 'offline' | 'unpaired' | 'unknown'>('unknown');
  const [ask, setAsk] = useState(false);
  const queued = useQueue((s) => s.items.length);

  useEffect(() => {
    if (!client) return;
    const off = client.onStatus(setStatus);
    client.warmUp();
    return off;
  }, [client]);

  if (!client) return null;
  const p = client.info;
  return (
    <Card tone={status === 'offline' || status === 'unpaired' ? 'warn' : 'info'} style={{ gap: space.sm }}>
      <Txt variant="bodyStrong" tone={status === 'offline' || status === 'unpaired' ? 'warn' : 'primary'}>
        {vi.plan.staffBanner(p.shopName, p.staffName)}
      </Txt>
      {status === 'offline' ? <Txt tone="warn">{vi.plan.staffOffline}</Txt> : null}
      {status === 'unpaired' ? <Txt tone="warn">{vi.errors.QP_PAIRING_EXPIRED}</Txt> : null}
      <Button kind="link" label={vi.plan.unpair} onPress={() => setAsk(true)} />
      <ConfirmSheet
        visible={ask}
        title={vi.plan.unpairAsk}
        body={vi.plan.unpairBody}
        yes={vi.plan.unpairYes}
        no={vi.common.back}
        danger
        onYes={() => {
          setAsk(false);
          void logoutHere(queued);
        }}
        onNo={() => setAsk(false)}
      />
    </Card>
  );
}
