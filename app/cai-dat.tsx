import { useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ErrorView, Toggle, callSupport } from '../src/components/States';
import { canManage, useBusinessId, useSession } from '../src/features/session/store';
import { useMainAccount } from '../src/features/session/hooks';
import { listMembers, registerDevice, signOut, updateBusinessSettings } from '../src/features/session/api';
import { usePrefs } from '../src/features/settings/prefs';
import { notificationsGranted, getPushToken } from '../src/features/notifications/setup';
import { speakVi } from '../src/features/sale/announce';
import { useQueue } from '../src/features/offline/useQueue';
import { bankDisplayName } from '../src/lib/banks';
import { readNumber } from '../src/lib/money';
import { getDeviceId } from '../src/lib/device';
import { ENV } from '../src/lib/env';
import { colors, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 4.2 Cài đặt (sau mã PIN chủ quán). */
export default function CaiDat() {
  const businessId = useBusinessId();
  const business = useSession((s) => s.business);
  const role = useSession((s) => s.role);
  const account = useMainAccount(businessId);
  const members = useQuery({ queryKey: ['members', businessId], queryFn: () => listMembers(businessId) });
  const notif = useQuery({ queryKey: ['notifGranted'], queryFn: notificationsGranted });
  const { speak, fontChoice, batteryDone, set } = usePrefs();
  const queued = useQueue((s) => s.items.length);
  const [logoutMsg, setLogoutMsg] = useState<string | null>(null);

  const stepsLeft = (notif.data ? 0 : 1) + (batteryDone ? 0 : 1);

  const speakMut = useMutation({
    mutationFn: async (v: boolean) =>
      registerDevice({ deviceId: await getDeviceId(), businessId, pushToken: await getPushToken(), speak: v }),
  });
  const manualMut = useMutation({
    mutationFn: (v: boolean) => updateBusinessSettings(businessId, v),
    onSuccess: (b) => useSession.getState().set({ business: b }),
  });

  const logout = async () => {
    if (queued > 0) return setLogoutMsg(vi.settings.logoutBlocked(queued));
    // Tắt cờ trước khi đăng xuất để không bị chuyển sang màn "Hết phiên"
    useSession.getState().set({ everSignedIn: false });
    await signOut();
    useSession.getState().reset();
    router.replace('/dang-nhap');
  };

  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={640}>
      <Txt variant="heading">{vi.settings.title}</Txt>

      <Card style={{ gap: 0, padding: 0 }}>
        <Row>
          <Txt variant="small" tone="secondary">
            {vi.settings.account}
          </Txt>
          {account.data ? (
            <>
              <Txt variant="title">{`${bankDisplayName(account.data.bank_bin)} · ${account.data.account_no}`}</Txt>
              <Txt variant="small" tone="success">
                {vi.settings.accountActive}
              </Txt>
            </>
          ) : (
            <Txt tone="warn">{vi.settings.accountNone}</Txt>
          )}
        </Row>
        <LinkRow label={vi.settings.staff} sub={members.data ? vi.settings.staffCount(members.data.length) : undefined} onPress={() => router.push('/nhan-vien')} last />
      </Card>

      <Card style={{ paddingVertical: 4 }}>
        <Toggle
          label={vi.settings.speak}
          hint={vi.settings.speakHint}
          value={speak}
          onChange={(v) => {
            set({ speak: v });
            speakMut.mutate(v);
          }}
        />
        {canManage(role) ? (
          <Toggle
            label={vi.settings.manualAllowed}
            hint={vi.settings.manualAllowedHint}
            value={business?.allow_cashier_manual_confirm ?? true}
            disabled={manualMut.isPending}
            onChange={(v) => manualMut.mutate(v)}
          />
        ) : null}
        {manualMut.error ? <ErrorView error={manualMut.error} /> : null}
        <Button kind="secondary" label={vi.settings.testVoice} onPress={() => speakVi(vi.paid.speakPaid(readNumber(18000)))} style={{ marginBottom: 12 }} />
      </Card>

      <Card>
        <Txt variant="bodyStrong">{vi.settings.fontSize}</Txt>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: space.sm }}>
          {(['lg', 'xl'] as const).map((c) => {
            const on = fontChoice === c;
            return (
              <Pressable
                key={c}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => set({ fontChoice: c })}
                style={{
                  flex: 1,
                  minHeight: 56,
                  borderRadius: 14,
                  borderWidth: on ? 3 : 2,
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primarySoft : colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt variant={c === 'xl' ? 'title' : 'bodyStrong'}>{c === 'xl' ? vi.settings.fontXLarge : vi.settings.fontLarge}</Txt>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: 0, padding: 0 }}>
        <Row>
          <Txt variant="bodyStrong">{vi.settings.einvoice}</Txt>
          <Txt variant="small" tone="secondary">
            {vi.settings.einvoiceSoon}
          </Txt>
        </Row>
        <LinkRow label={vi.common.callSupport} sub={ENV.supportPhone} onPress={callSupport} last />
      </Card>

      <Card style={{ gap: 0, padding: 0 }}>
        <LinkRow
          label={vi.settings.background}
          sub={vi.settings.backgroundLeft(stepsLeft)}
          subTone={stepsLeft > 0 ? 'warn' : 'success'}
          onPress={() => router.push('/pin-nen')}
        />
        <LinkRow label={vi.settings.privacy} onPress={() => ENV.policyUrl && void Linking.openURL(ENV.policyUrl)} last />
      </Card>

      {logoutMsg ? (
        <Card tone="warn">
          <Txt tone="warn" variant="bodyStrong">
            {logoutMsg}
          </Txt>
        </Card>
      ) : null}
      <Button kind="dangerOutline" label={vi.settings.logout} onPress={logout} />
      <Button kind="link" label={vi.settings.deleteAccount} onPress={() => router.push('/xoa-tai-khoan')} />
      <Txt variant="caption" tone="secondary" center>
        {vi.settings.version(ENV.appVersion)}
      </Txt>
    </Screen>
  );
}

function Row({ children, last }: { children: ReactNode; last?: boolean }) {
  return <View style={{ padding: 16, gap: 2, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.divider }}>{children}</View>;
}

function LinkRow({ label, sub, subTone = 'secondary', onPress, last }: { label: string; sub?: string; subTone?: 'secondary' | 'warn' | 'success'; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      onPress={onPress}
      style={{ minHeight: 64, padding: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.divider }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        {sub ? (
          <Txt variant="small" tone={subTone}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <Txt variant="heading">›</Txt>
    </Pressable>
  );
}
