import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { ProductForm } from '../../src/features/shop/components/ProductForm';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { vi } from '../../src/i18n/vi';

/** 6.1b Thêm món mới (có thể mở từ màn quét mã với mã vạch điền sẵn). Chỉ chủ/quản lý. */
export default function ThemMon() {
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));

  return (
    <Screen back={{ label: vi.catalog.title, href: '/hang-hoa' }} maxWidth={720}>
      <Txt variant="heading">{vi.catalog.addTitle}</Txt>
      {manage ? (
        <Card>
          <ProductForm
            businessId={businessId}
            initialBarcode={barcode}
            onSaved={() => (router.canGoBack() ? router.back() : router.replace('/hang-hoa'))}
          />
        </Card>
      ) : (
        <Txt tone="secondary">{vi.errors.QP_FORBIDDEN}</Txt>
      )}
    </Screen>
  );
}
