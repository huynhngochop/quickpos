import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { PaymentPanel } from '../../src/features/sale/PaymentPanel';
import { useSale } from '../../src/features/sale/store';
import { layoutFor } from '../../src/theme/layout';
import { vi } from '../../src/i18n/vi';

/** 2.3–2.6 Chờ khách chuyển khoản (một cột). Mở rộng lên ≥ 600dp thì quay về bố cục hai cột của /thu-tien. */
export default function ChoTien() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width, height, fontScale } = useWindowDimensions();
  const L = layoutFor(width, height, fontScale);
  const navigation = useNavigation();

  // Về màn Thu tiền: còn trong ngăn thì lùi đúng số màn, không có (mở từ Sổ nợ) thì thay màn này bằng Thu tiền.
  const toThuTien = () => {
    const st = navigation.getState() as { routes: { name: string }[]; index: number } | undefined;
    const routes = st?.routes ?? [];
    let at = -1;
    for (let i = routes.length - 1; i >= 0; i--) if (routes[i]!.name === 'thu-tien') { at = i; break; }
    if (at >= 0 && st) router.dismiss(st.index - at);
    else router.replace('/thu-tien');
  };

  useEffect(() => {
    if (id) useSale.getState().setActive(id);
  }, [id]);

  // Về màn Thu tiền (không chỉ "quay lại"): mở từ Sổ nợ → Thu nợ bằng mã QR thì màn trước là sổ nợ, không phải Thu tiền.
  useEffect(() => {
    if (L.kind === 'split') toThuTien();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L.kind]);

  const newSale = () => {
    useSale.getState().newSale();
    toThuTien();
  };

  return (
    <Screen back={{ label: vi.sale.editAmount }}>
      {id ? <PaymentPanel orderId={id} qrSize={L.qrSize} onNewSale={newSale} /> : null}
    </Screen>
  );
}
