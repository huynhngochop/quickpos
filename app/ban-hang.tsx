import { useMemo, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid } from '../src/components/Choice';
import { Empty, ErrorView, Loading } from '../src/components/States';
import { useBusinessId, useSession, canManage } from '../src/features/session/store';
import { useProducts, formatQty } from '../src/features/shop/hooks';
import { cartTotal, useSale, type CartLine } from '../src/features/sale/store';
import { formatVND } from '../src/lib/money';
import { colors, font, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 2.8 Chọn món: bấm món để thêm, +/− đổi số lượng, rồi "Thu tiền" (sang màn thu tiền với tổng đã tính). */
export default function BanHang() {
  const businessId = useBusinessId();
  const role = useSession((s) => s.role);
  const products = useProducts(businessId);
  const initial = useSale.getState().cart;
  const [cart, setCart] = useState<CartLine[]>(initial);
  const [cat, setCat] = useState<string>('ALL');
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;

  const cats = useMemo<string[]>(() => {
    const names: string[] = [];
    for (const p of products.data ?? []) if (p.category && !names.includes(p.category)) names.push(p.category);
    return ['ALL', ...names.sort()];
  }, [products.data]);
  const shown = (products.data ?? []).filter((p) => cat === 'ALL' || p.category === cat);
  const total = cartTotal(cart);
  const count = cart.reduce((n, l) => n + l.qty, 0);

  const add = (id: string, name: string, price: number, delta: number) =>
    setCart((c) => {
      const has = c.find((l) => l.productId === id);
      if (!has) return delta > 0 ? [...c, { productId: id, name, unitPrice: price, qty: delta }] : c;
      return c.map((l) => (l.productId === id ? { ...l, qty: Math.max(l.qty + delta, 0) } : l)).filter((l) => l.qty > 0);
    });

  const checkout = () => {
    useSale.getState().setCart(cart);
    router.replace('/thu-tien');
  };

  return (
    <Screen
      back={{ label: vi.sale.title, href: '/thu-tien' }}
      maxWidth={1000}
      footer={
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Txt variant="bodyStrong" tone="secondary" style={{ flex: 1 }}>
              {vi.catalog.cartCount(formatQty(count))}
            </Txt>
            <Amount value={formatVND(total)} size={font.size.amountSmall} center={false} />
          </View>
          <Button big label={vi.catalog.checkout} onPress={checkout} disabled={total <= 0} disabledLabel={vi.catalog.pickFirst} />
          {cart.length > 0 ? <Button kind="link" label={vi.catalog.clearCart} onPress={() => setCart([])} /> : null}
        </>
      }
    >
      <Txt variant="heading">{vi.catalog.pickTitle}</Txt>
      {cats.length > 2 ? (
        <ChoiceGrid options={cats.map((c) => ({ key: c, label: c === 'ALL' ? vi.catalog.all : c }))} value={cat} onChange={setCat} columns={3} />
      ) : null}
      {products.isLoading ? <Loading /> : null}
      {products.error ? <ErrorView error={products.error} onRetry={() => void products.refetch()} /> : null}
      {products.data && products.data.length === 0 ? (
        <>
          <Empty text={vi.catalog.emptySell} />
          {canManage(role) ? <Button kind="secondary" label={vi.catalog.addFirst} onPress={() => router.push('/hang-hoa')} /> : null}
        </>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {shown.map((p) => {
          const line = cart.find((l) => l.productId === p.id);
          const out = p.track_stock && p.stock_qty <= 0;
          return (
            <View key={p.id} style={{ flexBasis: `${Math.floor(100 / columns) - 3}%`, flexGrow: 1 }}>
              <Pressable
                testID={`sell-${p.name}`}
                accessibilityRole="button"
                accessibilityLabel={`${p.name}, ${formatVND(p.price)}${line ? `, đã chọn ${formatQty(line.qty)}` : ''}`}
                onPress={() => add(p.id, p.name, p.price, 1)}
                style={({ pressed }) => ({
                  minHeight: 96,
                  borderRadius: radius.lg,
                  borderWidth: line ? 3 : 2,
                  borderColor: line ? colors.primary : colors.border,
                  backgroundColor: pressed ? colors.divider : line ? colors.primarySoft : colors.surface,
                  padding: space.md,
                  justifyContent: 'space-between',
                })}
              >
                <Txt variant="bodyStrong" numberOfLines={2}>
                  {p.name}
                </Txt>
                <Txt variant="bodyStrong" tone="primary">
                  {formatVND(p.price)}
                </Txt>
                {p.track_stock ? (
                  <Txt variant="small" tone={out ? 'danger' : 'secondary'}>
                    {out ? vi.catalog.outOfStock : vi.catalog.stockLeft(formatQty(p.stock_qty), p.unit)}
                  </Txt>
                ) : null}
              </Pressable>
              {line ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
                  <Button kind="secondary" label={vi.catalog.less} onPress={() => add(p.id, p.name, p.price, -1)} style={{ flex: 1, minHeight: 56 }} />
                  <Txt variant="title" style={{ minWidth: 36 }} center>
                    {formatQty(line.qty)}
                  </Txt>
                  <Button kind="secondary" label={vi.catalog.more} onPress={() => add(p.id, p.name, p.price, 1)} style={{ flex: 1, minHeight: 56 }} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {cart.length > 0 ? (
        <Card style={{ gap: space.xs }}>
          {cart.map((l) => (
            <View key={l.productId} style={{ flexDirection: 'row', gap: space.md }}>
              <Txt style={{ flex: 1 }}>{`${formatQty(l.qty)} × ${l.name}`}</Txt>
              <Txt variant="bodyStrong">{formatVND(Math.round(l.qty * l.unitPrice))}</Txt>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
