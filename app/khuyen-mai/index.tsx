import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Empty, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { usePromotions } from '../../src/features/promo/api';
import { promoStatus, promoSummary } from '../../src/features/promo/describe';
import { useCategories, useProducts } from '../../src/features/shop/hooks';
import { vnDay } from '../../src/lib/time';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

/** 6.8 Khuyến mãi: các chương trình, đang chạy / tạm dừng / hết hạn. */
export default function KhuyenMai() {
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const promos = usePromotions(businessId);
  const products = useProducts(businessId, true);
  const cats = useCategories(businessId);
  const today = vnDay();
  const names = new Map<string, string>((products.data ?? []).map((p) => [p.id, p.name]));
  const catNames = new Map<string, string>((cats.data ?? []).map((c) => [c.id, c.name]));

  return (
    <Screen back={{ label: vi.catalog.title, href: '/hang-hoa' }} maxWidth={720}>
      <Txt variant="heading">{vi.inv.promosTitle}</Txt>
      <Txt tone="secondary">{vi.inv.promosHelp}</Txt>
      {manage ? (
        <Button big label={vi.inv.addPromo} onPress={() => router.push({ pathname: '/khuyen-mai/[id]', params: { id: 'moi' } })} testID="add-promo" />
      ) : null}
      {promos.isLoading ? <Loading /> : null}
      {promos.error ? <ErrorView error={promos.error} onRetry={() => void promos.refetch()} /> : null}
      {promos.data && promos.data.length === 0 ? <Empty text={vi.inv.promoEmpty} /> : null}
      {(promos.data ?? []).map((p) => {
        const st = promoStatus(p, today);
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${st.label}`}
            onPress={() => manage && router.push({ pathname: '/khuyen-mai/[id]', params: { id: p.id } })}
          >
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: st.running ? 1 : 0.7 }}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{p.name}</Txt>
                <Txt variant="small" tone="secondary">
                  {promoSummary(p, names, catNames)}
                </Txt>
                <Txt variant="small" tone={st.running ? 'success' : 'secondary'}>
                  {st.label}
                </Txt>
              </View>
              {manage ? (
                <Txt variant="heading" tone="secondary">
                  ›
                </Txt>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
