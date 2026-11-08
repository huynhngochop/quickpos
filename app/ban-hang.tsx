import { useEffect, useMemo, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid, Field } from '../src/components/Choice';
import { Empty, ErrorView, Loading } from '../src/components/States';
import { useBusinessId, useSession, canManage } from '../src/features/session/store';
import { useCategories, useProducts, useScanResult, formatQty } from '../src/features/shop/hooks';
import { usePromotions } from '../src/features/promo/api';
import { applyPromotions } from '../src/features/promo/engine';
import { vnDay } from '../src/lib/time';
import { findByBarcode, matchProduct } from '../src/features/shop/inventory';
import { cartTotal, useSale, type CartLine } from '../src/features/sale/store';
import { formatVND } from '../src/lib/money';
import { colors, font, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';
import type { Product } from '../src/types/api';

/**
 * 2.8 Chọn món: bấm món để thêm, +/− đổi số lượng, rồi "Tính tiền" (sang màn thu tiền với tổng đã tính).
 * Tìm theo tên/mã, hoặc "Quét mã" để quét liên tục từng món vào giỏ.
 */
export default function BanHang() {
  const businessId = useBusinessId();
  const role = useSession((s) => s.role);
  const business = useSession((s) => s.business);
  const promos = usePromotions(businessId);
  // Giảm tay: chủ / quản lý, hoặc thu ngân khi quán cho phép
  const canDiscount = canManage(role) || !!business?.allow_cashier_discount;
  const [manualText, setManualText] = useState(() => {
    const m = useSale.getState().pricing?.manualDiscount ?? 0;
    return m > 0 ? String(m) : '';
  });
  const [showManual, setShowManual] = useState(manualText !== '');
  const products = useProducts(businessId);
  const initial = useSale.getState().cart;
  const [cart, setCart] = useState<CartLine[]>(initial);
  const [cat, setCat] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;

  const categories = useCategories(businessId);
  const cats = useMemo(() => {
    const used = new Set((products.data ?? []).map((p) => p.category_id).filter(Boolean));
    return [{ key: 'ALL', label: vi.catalog.all }, ...(categories.data ?? []).filter((c) => used.has(c.id)).map((c) => ({ key: c.id, label: c.name }))];
  }, [products.data, categories.data]);
  const shown = (products.data ?? []).filter((p) => (cat === 'ALL' || p.category_id === cat) && matchProduct(p, query));
  const productMap = useMemo(
    () =>
      new Map<string, { name: string; price: number; category_id: string | null }>(
        (products.data ?? []).map((p) => [p.id, { name: p.name, price: p.price, category_id: p.category_id ?? null }]),
      ),
    [products.data],
  );
  const pricing = useMemo(
    () =>
      applyPromotions(
        cart.map((l) => ({ product_id: l.productId, category_id: l.categoryId ?? null, name: l.name, quantity: l.qty, unit_price: l.unitPrice })),
        promos.data ?? [],
        vnDay(),
        productMap,
        canDiscount ? Number(manualText || '0') : 0,
      ),
    [cart, promos.data, productMap, manualText, canDiscount],
  );
  const total = cart.length ? pricing.total : cartTotal(cart);
  const saved = pricing.itemDiscount + pricing.orderDiscount.amount + pricing.manualDiscount;
  const count = cart.reduce((n, l) => n + l.qty, 0);

  const add = (id: string, name: string, price: number, delta: number) =>
    setCart((c) => {
      const has = c.find((l) => l.productId === id);
      const categoryId = productMap.get(id)?.category_id ?? null;
      if (!has) return delta > 0 ? [...c, { productId: id, name, unitPrice: price, qty: delta, categoryId }] : c;
      return c.map((l) => (l.productId === id ? { ...l, qty: Math.max(l.qty + delta, 0) } : l)).filter((l) => l.qty > 0);
    });

  // Mã quét ở /quet-ma (chế độ bán) → thêm từng món vào giỏ
  const scanned = useScanResult((s) => s.queue);
  useEffect(() => {
    if (!scanned.length || !products.data) return;
    for (const code of useScanResult.getState().drain()) {
      const p = findByBarcode<Product>(products.data, code);
      if (p) add(p.id, p.name, p.price, 1);
    }
  }, [scanned, products.data]);

  const checkout = () => {
    useSale.getState().setCart(cart, saved > 0 || pricing.lines.some((l) => l.is_gift) ? pricing : null);
    router.replace('/thu-tien');
  };

  return (
    <Screen
      back={{ label: vi.sale.title, href: '/thu-tien' }}
      maxWidth={1000}
      footer={
        <>
          {saved > 0 ? (
            <Txt variant="bodyStrong" tone="success" testID="cart-saved">
              {vi.inv.youSave(formatVND(saved))}
            </Txt>
          ) : null}
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
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field label={vi.catalog.search} value={query} onChangeText={setQuery} maxLength={64} testID="sell-search" />
        </View>
        <Button kind="secondary" label={vi.catalog.scan} onPress={() => router.push({ pathname: '/quet-ma', params: { mode: 'sell' } })} />
      </View>
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
      {products.data && products.data.length > 0 && shown.length === 0 ? <Empty text={vi.catalog.noMatch} /> : null}
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
          {pricing.lines.map((l, i) => (
            <View key={`${l.product_id}-${i}`} style={{ flexDirection: 'row', gap: space.md }}>
              <Txt style={{ flex: 1 }} tone={l.is_gift ? 'success' : undefined}>
                {l.is_gift
                  ? vi.inv.giftLine(formatQty(l.quantity), l.name, pricing.applied.find((a) => a.promotion_id === l.promotion_id)?.name ?? '')
                  : `${formatQty(l.quantity)} × ${l.name}`}
              </Txt>
              <Txt variant="bodyStrong">{formatVND(l.line_amount)}</Txt>
            </View>
          ))}
          {pricing.applied
            .filter((a) => !a.gift)
            .map((a) => (
              <Txt key={a.promotion_id} tone="success">
                {vi.inv.discountLine(a.name, formatVND(a.amount))}
              </Txt>
            ))}
          {pricing.manualDiscount > 0 ? <Txt tone="success">{vi.inv.discountLine(vi.inv.manualDiscountName, formatVND(pricing.manualDiscount))}</Txt> : null}
        </Card>
      ) : null}
      {cart.length > 0 && canDiscount ? (
        showManual ? (
          <Field
            label={vi.inv.manualDiscount}
            value={manualText}
            onChangeText={(v) => setManualText(v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 10))}
            keyboardType="number-pad"
            testID="manual-discount"
          />
        ) : (
          <Button kind="link" label={vi.inv.manualDiscountBtn} onPress={() => setShowManual(true)} testID="open-manual-discount" />
        )
      ) : null}
    </Screen>
  );
}
