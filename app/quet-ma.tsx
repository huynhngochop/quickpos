import { useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { Field } from '../src/components/Choice';
import { canManage, useBusinessId, useSession } from '../src/features/session/store';
import { useProducts, useScanResult } from '../src/features/shop/hooks';
import { cleanCode, findByBarcode } from '../src/features/shop/inventory';
import { colors, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';
import type { Product } from '../src/types/api';

type Mode = 'find' | 'fill' | 'sell';

// Mã trên hàng bán lẻ ở Việt Nam: EAN-13/8, UPC, Code 128/39 (hàng tự dán nhãn), QR
const BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'qr'];

/**
 * 6.4 Quét mã vạch / mã QR bằng camera (có ô gõ mã khi không dùng được camera).
 *  - find: tìm món → mở món; chưa có thì gợi ý "Thêm món với mã này"
 *  - fill: điền mã vào ô của form thêm/sửa món rồi quay lại
 *  - sell: quét liên tục, mỗi lần thêm 1 món vào giỏ ở màn Chọn món
 */
export default function QuetMa() {
  const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = rawMode === 'fill' || rawMode === 'sell' ? rawMode : 'find';
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const products = useProducts(businessId, mode !== 'sell');
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const [missing, setMissing] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const { width, height } = useWindowDimensions();
  const camH = Math.min(Math.round(width * 0.75), Math.round(height * 0.4), 360);

  const handle = (raw: string) => {
    const code = cleanCode(raw);
    if (!code) return;
    // Camera đọc cùng một mã nhiều lần mỗi giây: bỏ qua lần lặp trong 2 giây
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 2000) return;
    last.current = { code, at: now };

    if (mode === 'fill') {
      useScanResult.getState().set(code);
      router.back();
      return;
    }
    const p = findByBarcode<Product>(products.data ?? [], code);
    if (mode === 'sell') {
      if (p && p.is_active) {
        useScanResult.getState().push(code);
        setMissing(null);
        setAdded(p.name);
      } else {
        setAdded(null);
        setMissing(code);
      }
      return;
    }
    if (p) router.replace({ pathname: '/hang-hoa/[id]', params: { id: p.id } });
    else setMissing(code);
  };

  const granted = !!permission?.granted;

  return (
    <Screen back={{ label: vi.common.back }} maxWidth={720}>
      <Txt variant="heading">{vi.catalog.scanTitle}</Txt>
      {granted ? (
        <>
          <Txt tone="secondary">{vi.catalog.scanHelp}</Txt>
          <View style={{ height: camH, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 2, borderColor: colors.ink }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
              onBarcodeScanned={(r: { data: string }) => handle(r.data)}
            />
          </View>
        </>
      ) : (
        <Card tone="info" style={{ gap: space.md }}>
          <Txt variant="bodyStrong">{permission && !permission.canAskAgain ? vi.catalog.cameraDenied : vi.catalog.cameraAsk}</Txt>
          {!permission || permission.canAskAgain ? (
            <Button label={vi.catalog.cameraAllow} onPress={() => void requestPermission()} />
          ) : null}
        </Card>
      )}

      {added ? (
        <Card tone="success">
          <Txt tone="success" variant="bodyStrong">{`✓ ${vi.catalog.addedToCart(added)}`}</Txt>
        </Card>
      ) : null}
      {missing ? (
        <Card tone="warn" style={{ gap: space.md }}>
          <Txt tone="warn" variant="bodyStrong">
            {vi.catalog.notFoundCode(missing)}
          </Txt>
          {manage && mode === 'find' ? (
            <Button
              kind="secondary"
              label={vi.catalog.addWithCode}
              onPress={() => router.replace({ pathname: '/hang-hoa/them', params: { barcode: missing } })}
            />
          ) : null}
        </Card>
      ) : null}

      <Field label={vi.catalog.typeCode} value={typed} onChangeText={(v) => setTyped(v.slice(0, 64))} maxLength={64} testID="scan-code" />
      <Button
        kind="secondary"
        label={vi.catalog.findCode}
        disabled={!cleanCode(typed)}
        disabledLabel={vi.catalog.typeCodeFirst}
        onPress={() => {
          last.current = { code: '', at: 0 };
          handle(typed);
          setTyped('');
        }}
      />
      {mode === 'sell' ? <Button big label={vi.catalog.scanDone} onPress={() => router.back()} /> : null}
    </Screen>
  );
}
