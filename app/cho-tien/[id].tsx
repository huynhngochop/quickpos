import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { PaymentPanel } from '../../src/features/sale/PaymentPanel';
import { useSale } from '../../src/features/sale/store';
import { layoutFor } from '../../src/theme/layout';
import { vi } from '../../src/i18n/vi';

/** 2.3–2.6 Chờ khách chuyển khoản (một cột). Mở rộng lên ≥ 600dp thì quay về bố cục hai cột của /thu-tien. */
export default function ChoTien() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { width, height, fontScale } = useWindowDimensions();
  const L = layoutFor(width, height, fontScale);
  // Về màn Thu tiền. Mở từ Thu tiền (from=thu-tien, màn này nằm ngay trên Thu tiền) thì chỉ lùi một màn; mở từ chỗ khác
  // (Sổ nợ → Thu nợ bằng mã QR) thì thay màn này bằng Thu tiền. Không suy từ trạng thái ngăn điều hướng (tên tuyến đổi theo
  // cách lồng màn — đã gây lỗi "Đơn mới" không ăn, QA 08/11/2026).
  const toThuTien = () => {
    const back = from === 'thu-tien' && router.canGoBack();
    console.warn('[QP] đơn mới → thu tiền', back ? 'lùi' : 'thay', from ?? '-');
    if (back) router.back();
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
    console.warn('[QP] bấm đơn mới');
    useSale.getState().newSale();
    toThuTien();
  };

  return (
    <Screen back={{ label: vi.sale.editAmount }}>
      {id ? <PaymentPanel orderId={id} qrSize={L.qrSize} onNewSale={newSale} /> : null}
    </Screen>
  );
}
