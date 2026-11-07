import { useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { Field } from '../src/components/Choice';
import { ErrorView } from '../src/components/States';
import { pairWithHost } from '../src/features/lan/client';
import { decodePairingQr } from '../src/features/lan/protocol';
import { connect } from '../src/features/lan/tcp';
import { getDeviceId } from '../src/lib/device';
import { setStaffPairing } from '../src/lib/supabase';
import { queryClient } from '../src/lib/queryClient';
import { useSession } from '../src/features/session/store';
import { colors, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/**
 * Gói Pro — máy nhân viên: quét mã ghép máy trên máy chủ quán (hoặc dán mã), rồi dùng app như bình thường.
 * Mọi lệnh gửi tới máy chủ quán qua Wi‑Fi; máy này không giữ dữ liệu của quán.
 */
export default function NoiMayChu() {
  const [permission, requestPermission] = useCameraPermissions();
  const [name, setName] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const tried = useRef('');
  const { width, height } = useWindowDimensions();
  const camH = Math.min(Math.round(width * 0.75), Math.round(height * 0.35), 320);

  const go = async (raw: string) => {
    if (busy || raw === tried.current) return;
    const qr = decodePairingQr(raw);
    if (!qr) {
      setProblem(vi.plan.pairBad);
      return;
    }
    tried.current = raw;
    setProblem(null);
    setError(null);
    setBusy(true);
    try {
      const p = await pairWithHost(connect, qr, await getDeviceId(), name.trim() || vi.plan.roles.CASHIER!);
      setStaffPairing(p);
      queryClient.clear();
      useSession.getState().reset();
      router.replace('/');
    } catch (e) {
      tried.current = '';
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back={{ label: vi.common.back }} maxWidth={640}>
      <Txt variant="heading">{vi.plan.pairTitle}</Txt>
      <Txt tone="secondary">{vi.plan.pairBody}</Txt>
      <Field label={vi.plan.pairName} value={name} onChangeText={(v) => setName(v.slice(0, 40))} maxLength={40} testID="pair-name" />
      {permission?.granted ? (
        <View style={{ height: camH, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 2, borderColor: colors.ink }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(r: { data: string }) => void go(r.data)}
          />
        </View>
      ) : (
        <Card tone="info" style={{ gap: space.md }}>
          <Txt variant="bodyStrong">{permission && !permission.canAskAgain ? vi.catalog.cameraDenied : vi.catalog.cameraAsk}</Txt>
          {!permission || permission.canAskAgain ? <Button label={vi.catalog.cameraAllow} onPress={() => void requestPermission()} /> : null}
        </Card>
      )}
      <Field label={vi.plan.pairPaste} value={typed} onChangeText={(v) => setTyped(v.trim().slice(0, 400))} maxLength={400} testID="pair-code" />
      {problem ? (
        <Txt tone="danger" variant="bodyStrong">
          {problem}
        </Txt>
      ) : null}
      {error ? <ErrorView error={error} /> : null}
      <Button big label={busy ? vi.plan.pairing : vi.plan.pairGo} busy={busy} disabled={!typed} disabledLabel={vi.plan.pairPasteFirst} onPress={() => void go(typed)} />
    </Screen>
  );
}
