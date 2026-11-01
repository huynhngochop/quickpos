import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ChoiceGrid, Field } from '../../src/components/Choice';
import { Empty, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useExpiringLots, useProducts, formatQty } from '../../src/features/shop/hooks';
import { isLowStock, matchProduct, nearestExpiryByProduct } from '../../src/features/shop/inventory';
import { formatVND } from '../../src/lib/money';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

type Filter = 'ALL' | 'LOW' | 'EXPIRY' | 'STOPPED';

/**
 * 6.1 Hàng hóa: tìm theo tên/mã vạch, quét mã, lọc sắp hết hàng / sắp hết hạn / ngừng bán,
 * thêm món, xuất nhập tồn. Chủ/quản lý sửa; thu ngân xem và nhập hàng.
 */
export default function HangHoa() {
  const params = useLocalSearchParams<{ filter?: string; msg?: string }>();
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const products = useProducts(businessId, true);
  const expiring = useExpiringLots(businessId);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(params.filter === 'EXPIRY' ? 'EXPIRY' : params.filter === 'LOW' ? 'LOW' : 'ALL');

  const rows = products.data ?? [];
  const lots = expiring.data ?? [];
  const nearest = nearestExpiryByProduct(lots);
  const lowCount = rows.filter(isLowStock).length;
  const shown = rows.filter((p) => {
    if (!matchProduct(p, query)) return false;
    if (filter === 'LOW') return isLowStock(p);
    if (filter === 'EXPIRY') return nearest.has(p.id);
    if (filter === 'STOPPED') return !p.is_active;
    return true;
  });

  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={720}>
      <Txt variant="heading">{vi.catalog.title}</Txt>
      <Txt tone="secondary">{vi.catalog.subtitle}</Txt>
      {params.msg === 'DELETED' || params.msg === 'ARCHIVED' ? (
        <Card tone="success">
          <Txt tone="success" variant="bodyStrong">
            {`✓ ${params.msg === 'DELETED' ? vi.catalog.deleted : vi.catalog.archived}`}
          </Txt>
        </Card>
      ) : null}

      {lots.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={vi.catalog.expiringCard(lots.length)} onPress={() => setFilter('EXPIRY')}>
          <Card tone="warn">
            <Txt tone="warn" variant="bodyStrong">
              {vi.catalog.expiringCard(lots.length)}
            </Txt>
          </Card>
        </Pressable>
      ) : null}

      {manage ? <Button big label={vi.catalog.add} onPress={() => router.push('/hang-hoa/them')} /> : null}
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Button kind="secondary" label={vi.catalog.scan} onPress={() => router.push({ pathname: '/quet-ma', params: { mode: 'find' } })} style={{ flex: 1 }} />
        <Button kind="secondary" label={vi.catalog.stockReport} onPress={() => router.push('/hang-hoa/xuat-nhap-ton')} style={{ flex: 1 }} />
      </View>

      <Field label={vi.catalog.search} value={query} onChangeText={setQuery} maxLength={64} testID="product-search" />
      <ChoiceGrid
        options={[
          { key: 'ALL' as Filter, label: vi.catalog.filterAll },
          { key: 'LOW' as Filter, label: lowCount ? `${vi.catalog.filterLow} (${lowCount})` : vi.catalog.filterLow },
          { key: 'EXPIRY' as Filter, label: nearest.size ? `${vi.catalog.filterExpiry} (${nearest.size})` : vi.catalog.filterExpiry },
          { key: 'STOPPED' as Filter, label: vi.catalog.filterStopped },
        ]}
        value={filter}
        onChange={setFilter}
        columns={2}
        testIdPrefix="product-filter"
      />

      {products.isLoading ? <Loading /> : null}
      {products.error ? <ErrorView error={products.error} onRetry={() => void products.refetch()} /> : null}
      {products.data && rows.length === 0 ? <Empty text={vi.catalog.empty} /> : null}
      {products.data && rows.length > 0 && shown.length === 0 ? <Empty text={vi.catalog.noMatch} /> : null}
      {shown.length > 0 ? (
        <Txt variant="small" tone="secondary">
          {vi.catalog.count(shown.length)}
        </Txt>
      ) : null}
      {shown.map((p) => {
        const lot = nearest.get(p.id);
        const low = isLowStock(p);
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${formatVND(p.price)}`}
            onPress={() => router.push({ pathname: '/hang-hoa/[id]', params: { id: p.id } })}
          >
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: p.is_active ? 1 : 0.6 }}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{p.name}</Txt>
                <Txt variant="small" tone="secondary">
                  {[`${formatVND(p.price)} / ${p.unit}`, p.category, p.barcode, !p.is_active ? vi.catalog.inactive : null].filter(Boolean).join(' · ')}
                </Txt>
                {p.track_stock ? (
                  <Txt variant="small" tone={low ? 'warn' : 'success'}>
                    {low ? `${vi.catalog.stockLeft(formatQty(p.stock_qty), p.unit)} · ${vi.catalog.filterLow}` : vi.catalog.stockLeft(formatQty(p.stock_qty), p.unit)}
                  </Txt>
                ) : null}
                {lot ? (
                  <Txt variant="small" tone={lot.days_left < 0 ? 'danger' : 'warn'}>
                    {`${vi.catalog.expiresIn(lot.days_left)} · ${formatQty(lot.qty_left)} ${lot.unit}`}
                  </Txt>
                ) : null}
              </View>
              <Txt variant="heading" tone="secondary">
                ›
              </Txt>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
