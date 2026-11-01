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
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width, height, fontScale } = useWindowDimensions();
  const L = layoutFor(width, height, fontScale);

  useEffect(() => {
    if (id) useSale.getState().setActive(id);
  }, [id]);

  // Về màn Thu tiền (không chỉ "quay lại"): mở từ Sổ nợ → Thu nợ bằng mã QR thì màn trước là sổ nợ, không phải Thu tiền.
  // dismissTo: có Thu tiền trong ngăn thì lùi về đó, chưa có thì thay màn này bằng Thu tiền.
  useEffect(() => {
    if (L.kind === 'split') router.dismissTo('/thu-tien');
  }, [L.kind]);

  const newSale = () => {
    useSale.getState().newSale();
    router.dismissTo('/thu-tien');
  };

  return (
    <Screen back={{ label: vi.sale.editAmount }}>
      {id ? <PaymentPanel orderId={id} qrSize={L.qrSize} onNewSale={newSale} /> : null}
    </Screen>
  );
}
