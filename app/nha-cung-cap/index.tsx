import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Empty, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useSupplierBalances } from '../../src/features/shop/hooks';
import { dayToVN } from '../../src/features/shop/inventory';
import { formatVND } from '../../src/lib/money';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

/** 6.6 Nhà cung cấp: danh sách, quán còn nợ ai bao nhiêu (nợ nhiều nhất lên đầu). */
export default function NhaCungCap() {
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const list = useSupplierBalances(businessId);
  const rows = list.data ?? [];
  const owe = rows.reduce((t, r) => t + Math.max(r.balance, 0), 0);

  return (
    <Screen back={{ label: vi.catalog.title, href: '/hang-hoa' }} maxWidth={720}>
      <Txt variant="heading">{vi.inv.suppliersTitle}</Txt>
      <Txt tone="secondary">{vi.inv.suppliersHelp}</Txt>
      {manage ? <Button big label={vi.inv.addSupplier} onPress={() => router.push('/nha-cung-cap/them')} testID="add-supplier" /> : null}
      {owe > 0 ? (
        <Card tone="warn">
          <Txt tone="warn" variant="bodyStrong">
            {vi.inv.totalOwe(formatVND(owe))}
          </Txt>
        </Card>
      ) : null}
      {list.isLoading ? <Loading /> : null}
      {list.error ? <ErrorView error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && rows.length === 0 ? <Empty text={vi.inv.supplierEmpty} /> : null}
      {rows.map((r) => (
        <Pressable
          key={r.supplier_id}
          accessibilityRole="button"
          accessibilityLabel={`${r.name}, ${r.balance > 0 ? vi.inv.owe(formatVND(r.balance)) : vi.inv.oweNone}`}
          onPress={() => router.push({ pathname: '/nha-cung-cap/[id]', params: { id: r.supplier_id } })}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{r.name}</Txt>
              <Txt variant="small" tone={r.balance > 0 ? 'warn' : 'success'}>
                {r.balance > 0 ? vi.inv.owe(formatVND(r.balance)) : r.balance < 0 ? vi.inv.prepaid(formatVND(-r.balance)) : vi.inv.oweNone}
              </Txt>
              {r.last_purchase_on ? (
                <Txt variant="small" tone="secondary">
                  {vi.inv.lastPurchase(dayToVN(r.last_purchase_on))}
                </Txt>
              ) : null}
            </View>
            <Txt variant="heading" tone="secondary">
              ›
            </Txt>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
