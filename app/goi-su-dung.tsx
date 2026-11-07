import { useEffect, useState } from 'react';
import { Linking, Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid, Field } from '../src/components/Choice';
import { ConfirmSheet } from '../src/components/ConfirmSheet';
import { Checkbox, ErrorView, Loading, callSupport } from '../src/components/States';
import { usePrefs } from '../src/features/settings/prefs';
import { useBusinessId, useSession } from '../src/features/session/store';
import { usePlan } from '../src/features/plan/hooks';
import { activateLicense, startProTrial } from '../src/features/plan/api';
import { formatShopKey, shopKey } from '../src/features/plan/license';
import { HOST_PORT, getHost, hostIdNow, hostIp, refreshKeepAwake, syncHost } from '../src/features/lan/hostRuntime';
import { encodePairingQr, type LanRole } from '../src/features/lan/protocol';
import { buildVietQr } from '../supabase/functions/_shared/vietqr';
import { bankDisplayName } from '../src/lib/banks';
import { ENV } from '../src/lib/env';
import { formatVND } from '../src/lib/money';
import { formatDateVN, formatTimeVN } from '../src/lib/time';
import { dayToVN } from '../src/features/shop/inventory';
import { colors, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

const QR_SIZE = 220;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Gói sử dụng (chủ quán, sau PIN): Miễn phí / Pro dùng thử 30 ngày / Pro theo năm (mã kích hoạt) / Premium sắp có.
 * Pro: máy này làm máy chủ quán — thêm, xem, thu hồi máy nhân viên.
 */
export default function GoiSuDung() {
  const businessId = useBusinessId();
  const shopName = useSession((s) => s.business?.business_name ?? '');
  const qc = useQueryClient();
  const plan = usePlan(businessId);
  const st = plan.status;
  const key = shopKey(businessId);
  const [askTrial, setAskTrial] = useState(false);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = (row: Awaited<ReturnType<typeof startProTrial>>) => {
    qc.setQueryData(['plan', businessId], row);
    syncHost({ businessId, name: shopName }, row);
  };
  const trial = useMutation({
    mutationFn: () => startProTrial(businessId),
    onSuccess: (r) => {
      setAskTrial(false);
      refresh(r);
    },
  });
  const act = useMutation({
    mutationFn: () => activateLicense(businessId, code),
    onSuccess: (r) => {
      refresh(r);
      setCode('');
      setMsg('ok');
    },
  });

  const payQr = (() => {
    if (!ENV.vendorBankBin || !ENV.vendorAccountNo) return null;
    try {
      return buildVietQr({ bankBin: ENV.vendorBankBin, accountNo: ENV.vendorAccountNo, amount: ENV.proPriceYear || undefined, content: `QPPRO ${key}` });
    } catch {
      return null;
    }
  })();

  return (
    <Screen back={{ label: vi.settings.title, href: '/cai-dat' }} maxWidth={720}>
      <Txt variant="heading">{vi.plan.title}</Txt>
      {plan.isLoading ? <Loading /> : null}
      {plan.error ? <ErrorView error={plan.error} onRetry={() => void plan.refetch()} /> : null}

      {st ? (
        <Card tone={st.kind === 'PRO_EXPIRED' ? 'warn' : st.active ? 'success' : undefined} style={{ gap: space.sm }}>
          <Txt variant="title" tone={st.kind === 'PRO_EXPIRED' ? 'warn' : st.active ? 'success' : 'ink'}>
            {st.kind === 'FREE'
              ? vi.plan.free
              : st.kind === 'PRO_TRIAL'
                ? vi.plan.trial(st.daysLeft)
                : st.kind === 'PRO'
                  ? vi.plan.pro(dayToVN(st.until!))
                  : vi.plan.expired}
          </Txt>
          <Txt tone="secondary">{st.kind === 'PRO_EXPIRED' ? vi.plan.expiredBody : st.kind === 'FREE' ? vi.plan.freeBody : vi.plan.hostBody}</Txt>
          {st.kind === 'FREE' ? <Button big label={vi.plan.startTrial} onPress={() => setAskTrial(true)} /> : null}
        </Card>
      ) : null}

      <Card style={{ gap: space.xs }}>
        {vi.plan.tiers.map((t) => (
          <Txt key={t} variant="small" tone="secondary">{`• ${t}`}</Txt>
        ))}
      </Card>

      {st?.active ? <Devices businessId={businessId} shopName={shopName} /> : null}

      {st && st.kind !== 'FREE' ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="title">{vi.plan.buyTitle}</Txt>
          <Txt variant="bodyStrong">{ENV.proPriceYear ? vi.plan.price(formatVND(ENV.proPriceYear)) : vi.plan.priceAsk}</Txt>
          <Txt variant="bodyStrong" testID="shop-key">
            {vi.plan.shopKey(formatShopKey(key))}
          </Txt>
          <Txt tone="secondary">{vi.plan.buyHow}</Txt>
          {payQr ? (
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <View style={{ padding: space.md, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
                <QRCode value={payQr} size={QR_SIZE} />
              </View>
              <Txt variant="small" tone="secondary" center>
                {`${bankDisplayName(ENV.vendorBankBin)} · ${ENV.vendorAccountNo}${ENV.vendorAccountName ? ` · ${ENV.vendorAccountName}` : ''}`}
              </Txt>
            </View>
          ) : null}
          <Txt variant="bodyStrong">{vi.plan.buyContent(key)}</Txt>
          <Txt variant="small" tone="secondary">
            {vi.plan.buyCard}
          </Txt>
          <Button
            kind="secondary"
            label={vi.plan.contact}
            onPress={() => (ENV.vendorZalo ? void Linking.openURL(`https://zalo.me/${ENV.vendorZalo.replace(/\D/g, '')}`) : callSupport())}
          />
          <Field label={vi.plan.codeField} value={code} onChangeText={(v) => setCode(v.slice(0, 300))} maxLength={300} testID="license-code" />
          {msg === 'ok' && st.kind === 'PRO' ? (
            <Txt tone="success" variant="bodyStrong">{`✓ ${vi.plan.activated(dayToVN(st.until!))}`}</Txt>
          ) : null}
          {act.error ? <ErrorView error={act.error} /> : null}
          <Button
            label={vi.plan.activate}
            disabled={code.trim().length < 10}
            disabledLabel={vi.plan.enterCode}
            onPress={() => act.mutate()}
            busy={act.isPending}
          />
        </Card>
      ) : null}

      <ConfirmSheet
        visible={askTrial}
        title={vi.plan.startTrialAsk}
        body={vi.plan.startTrialBody}
        yes={vi.plan.startTrialYes}
        no={vi.common.back}
        busy={trial.isPending}
        onYes={() => trial.mutate()}
        onNo={() => setAskTrial(false)}
      />
    </Screen>
  );
}

/** Máy chủ quán: thêm máy nhân viên bằng mã QR, danh sách máy, thu hồi */
function Devices({ businessId, shopName }: { businessId: string; shopName: string }) {
  const host = getHost();
  const qc = useQueryClient();
  const [, setTick] = useState(0);
  const [name, setName] = useState('');
  const [role, setRole] = useState<LanRole>('CASHIER');
  const [pair, setPair] = useState<{ qr: string; expiresAt: number } | null>(null);
  const [showText, setShowText] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  const ip = useQuery({ queryKey: ['lan-ip'], queryFn: hostIp, refetchInterval: 15_000 });
  const planRow = qc.getQueryData<{ trialStartedAt: string | null; licenseCode: string | null }>(['plan', businessId]);

  useEffect(() => host.subscribe(() => setTick((t) => t + 1)), [host]);
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pair]);

  const showQr = () => {
    if (!ip.data || !planRow) return;
    syncHost({ businessId, name: shopName }, planRow, true);
    const p = host.startPairing(role, name || vi.plan.roles[role]!);
    setPair({ qr: encodePairingQr({ h: ip.data, p: HOST_PORT, i: hostIdNow(), k: p.key }), expiresAt: p.expiresAt });
    setShowText(false);
    setNow(Date.now());
  };

  const devices = host.list();
  const keepAwake = usePrefs((s) => s.hostKeepAwake);
  const expired = pair ? pair.expiresAt <= now : false;

  return (
    <Card style={{ gap: space.md }}>
      <Txt variant="title">{vi.plan.devicesTitle}</Txt>
      <Txt variant="small" tone="warn">
        {vi.plan.hostAdvice}
      </Txt>
      {ip.data ? (
        <Txt variant="small" tone="secondary">
          {vi.plan.hostAt(ip.data)}
        </Txt>
      ) : ip.isSuccess ? (
        <Txt tone="warn" variant="bodyStrong">
          {vi.plan.noWifi}
        </Txt>
      ) : null}

      <Checkbox
        label={vi.plan.keepAwake}
        value={keepAwake}
        onChange={(v) => {
          usePrefs.getState().set({ hostKeepAwake: v });
          refreshKeepAwake();
        }}
      />
      {devices.length === 0 ? <Txt tone="secondary">{vi.plan.noDevices}</Txt> : null}
      {devices.map((d) => (
        <View key={d.deviceId} style={{ gap: space.xs, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.sm }}>
          <Txt variant="bodyStrong">{`${d.name} · ${vi.plan.roles[d.role]}`}</Txt>
          <Txt variant="small" tone={d.online ? 'success' : 'secondary'}>
            {[d.online ? vi.plan.online : vi.plan.offline, d.lastSeenAt ? vi.plan.lastSeen(`${formatTimeVN(d.lastSeenAt)} ${formatDateVN(d.lastSeenAt)}`) : null]
              .filter(Boolean)
              .join(' · ')}
          </Txt>
          <Button kind="dangerOutline" label={vi.plan.revoke} onPress={() => setRevoke({ id: d.deviceId, name: d.name })} />
        </View>
      ))}

      <Txt variant="title">{vi.plan.addDevice}</Txt>
      <Field label={vi.plan.staffName} value={name} onChangeText={(v) => setName(v.slice(0, 40))} maxLength={40} testID="lan-staff-name" />
      <Txt variant="bodyStrong">{vi.plan.staffRole}</Txt>
      <ChoiceGrid
        options={(['CASHIER', 'MANAGER'] as LanRole[]).map((r) => ({ key: r, label: vi.plan.roles[r]! }))}
        value={role}
        onChange={setRole}
        columns={2}
        testIdPrefix="lan-role"
      />
      <Button big label={vi.plan.showQr} onPress={showQr} disabled={!ip.data} disabledLabel={vi.plan.noWifi} />
      {pair && !expired ? (
        <View style={{ alignItems: 'center', gap: space.sm }} testID="lan-pair-qr">
          <View style={{ padding: space.md, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
            <QRCode value={pair.qr} size={QR_SIZE} />
          </View>
          <Txt variant="small" tone="secondary" center>
            {vi.plan.qrHelp}
          </Txt>
          <Txt variant="bodyStrong" center>
            {vi.plan.qrExpires(mmss(pair.expiresAt - now))}
          </Txt>
          <Button kind="link" label={vi.plan.sharePair} onPress={() => void Share.share({ message: pair.qr })} />
          {showText ? (
            <>
              <Txt variant="small" tone="secondary" center>
                {vi.plan.pairTextHelp}
              </Txt>
              <Txt variant="small" selectable center testID="lan-pair-text">
                {pair.qr}
              </Txt>
            </>
          ) : (
            <Button kind="link" label={vi.plan.showPairText} onPress={() => setShowText(true)} testID="lan-pair-show-text" />
          )}
        </View>
      ) : pair && expired ? (
        <Txt tone="warn">{vi.plan.qrExpired}</Txt>
      ) : null}

      <ConfirmSheet
        visible={!!revoke}
        title={revoke ? vi.plan.revokeAsk(revoke.name) : ''}
        body={vi.plan.revokeBody}
        yes={vi.plan.revokeYes}
        no={vi.common.back}
        danger
        onYes={() => {
          if (revoke) host.revoke(revoke.id);
          setRevoke(null);
        }}
        onNo={() => setRevoke(null)}
      />
    </Card>
  );
}
