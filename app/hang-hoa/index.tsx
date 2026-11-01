import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { Checkbox, Empty, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useProducts, formatQty } from '../../src/features/shop/hooks';
import { upsertProduct } from '../../src/features/shop/api';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);

/** 6.1 Hàng hóa: danh sách món (giá, tồn kho, sắp hết), thêm món mới. Chủ/quản lý sửa; thu ngân xem. */
export default function HangHoa() {
  const businessId = useBusinessId();
  const role = useSession((s) => s.role);
  const manage = canManage(role);
  const products = useProducts(businessId, true);
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [track, setTrack] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const productId = useRef(newId());

  const add = useMutation({
    mutationFn: () =>
      upsertProduct({
        productId: productId.current, businessId, name: name.trim(), price: Number(price || '0'),
        unit: unit.trim() || vi.catalog.defaultUnit, category: category.trim() || null, trackStock: track,
      }),
    onSuccess: () => {
      productId.current = newId();
      setName('');
      setPrice('');
      setUnit('');
      setCategory('');
      setTrack(false);
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['products', businessId] });
    },
  });

  const save = () => {
    if (!name.trim()) return setProblem(vi.catalog.enterName);
    if (!price) return setProblem(vi.catalog.enterPrice);
    setProblem(null);
    add.mutate();
  };

  const rows = products.data ?? [];
  const low = rows.filter((p) => p.is_active && p.track_stock && p.stock_qty <= (p.low_stock_at ?? 0));

  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={720}>
      <Txt variant="heading">{vi.catalog.title}</Txt>
      <Txt tone="secondary">{vi.catalog.subtitle}</Txt>
      {low.length > 0 ? (
        <Card tone="warn">
          <Txt tone="warn" variant="bodyStrong">
            {vi.catalog.lowStock(low.map((p) => p.name).join(', '))}
          </Txt>
        </Card>
      ) : null}

      {manage ? (
        adding ? (
          <Card style={{ gap: space.md }}>
            <Txt variant="title">{vi.catalog.add}</Txt>
            <Field label={vi.catalog.name} value={name} onChangeText={setName} maxLength={100} testID="product-name" />
            <Field label={vi.catalog.price} value={price} onChangeText={(v) => setPrice(digits(v))} keyboardType="number-pad" testID="product-price" />
            {price ? <Txt tone="secondary">{formatVND(Number(price))}</Txt> : null}
            <Field label={vi.catalog.unit} value={unit} onChangeText={setUnit} maxLength={20} testID="product-unit" placeholder={vi.catalog.unitHint} />
            <Field label={vi.catalog.category} value={category} onChangeText={setCategory} maxLength={50} testID="product-category" placeholder={vi.catalog.categoryHint} />
            <Checkbox label={vi.catalog.trackStock} value={track} onChange={setTrack} />
            {problem ? <Txt tone="danger" variant="bodyStrong">{problem}</Txt> : null}
            {add.error ? <ErrorView error={add.error} /> : null}
            <Button big label={vi.catalog.save} onPress={save} busy={add.isPending} />
            <Button kind="link" label={vi.common.back} onPress={() => setAdding(false)} />
          </Card>
        ) : (
          <Button big label={vi.catalog.add} onPress={() => setAdding(true)} />
        )
      ) : null}

      {products.isLoading ? <Loading /> : null}
      {products.error ? <ErrorView error={products.error} onRetry={() => void products.refetch()} /> : null}
      {products.data && rows.length === 0 ? <Empty text={vi.catalog.empty} /> : null}
      {rows.map((p) => (
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
                {[`${formatVND(p.price)} / ${p.unit}`, p.category, !p.is_active ? vi.catalog.inactive : null].filter(Boolean).join(' · ')}
              </Txt>
              {p.track_stock ? (
                <Txt variant="small" tone={p.stock_qty <= (p.low_stock_at ?? 0) ? 'warn' : 'success'}>
                  {vi.catalog.stockLeft(formatQty(p.stock_qty), p.unit)}
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
