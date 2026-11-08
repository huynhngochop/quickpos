import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../../components/Screen';
import { Txt } from '../../../components/Txt';
import { Button } from '../../../components/Button';
import { ChoiceGrid, Field } from '../../../components/Choice';
import { ErrorView } from '../../../components/States';
import { upsertCategory } from '../api';
import { formatQty, useCategories, useProducts, useScanResult, useSuppliers } from '../hooks';
import { findByBarcode, matchProduct } from '../inventory';
import { formatVND } from '../../../lib/money';
import { newId } from '../../../lib/device';
import { space } from '../../../theme/tokens';
import { vi } from '../../../i18n/vi';
import type { Category, Product } from '../../../types/api';

const NONE = '__none__';

/** Chọn danh mục (nút bấm, không cần gõ); có ô thêm nhanh danh mục mới. */
export function CategoryPicker({
  businessId,
  value,
  onChange,
  allowCreate = false,
  label = vi.inv.categoryField,
}: {
  businessId: string;
  value: string | null;
  onChange: (id: string | null, c: Category | null) => void;
  allowCreate?: boolean;
  label?: string;
}) {
  const qc = useQueryClient();
  const cats = useCategories(businessId);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => upsertCategory({ categoryId: newId(), businessId, name: name.trim(), sortOrder: cats.data?.length ?? 0 }),
    onSuccess: (c) => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['products', businessId] });
      onChange(c.id, c);
    },
  });
  const list = cats.data ?? [];
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="bodyStrong">{label}</Txt>
      <ChoiceGrid
        options={[{ key: NONE, label: vi.inv.noCategory }, ...list.map((c) => ({ key: c.id, label: c.name }))]}
        value={value ?? NONE}
        onChange={(k) => onChange(k === NONE ? null : k, list.find((c) => c.id === k) ?? null)}
        columns={2}
        testIdPrefix="category"
      />
      {allowCreate ? (
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label={vi.inv.newCategory} value={name} onChangeText={setName} maxLength={50} testID="category-new" />
          </View>
          <Button kind="secondary" label={vi.inv.addCategory} onPress={() => name.trim() && add.mutate()} busy={add.isPending} />
        </View>
      ) : null}
      {add.error ? <ErrorView error={add.error} /> : null}
    </View>
  );
}

export function SupplierPicker({
  businessId,
  value,
  onChange,
}: {
  businessId: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const sup = useSuppliers(businessId);
  const list = sup.data ?? [];
  if (list.length === 0) {
    return (
      <View style={{ gap: space.xs }}>
        <Txt variant="bodyStrong">{vi.inv.supplierField}</Txt>
        <Button kind="link" label={vi.inv.addSupplier} onPress={() => router.push('/nha-cung-cap/them')} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="bodyStrong">{vi.inv.supplierField}</Txt>
      <ChoiceGrid
        options={[{ key: NONE, label: vi.inv.noSupplier }, ...list.map((s) => ({ key: s.id, label: s.name }))]}
        value={value ?? NONE}
        onChange={(k) => onChange(k === NONE ? null : k)}
        columns={2}
        testIdPrefix="supplier"
      />
    </View>
  );
}

/**
 * Tìm món theo tên / mã vạch hoặc quét mã, bấm để chọn. Dùng ở phiếu nhập, khuyến mãi, kiểm kê.
 * Quét được đúng một món thì chọn luôn.
 */
export function ProductPicker({
  businessId,
  onPick,
  label = vi.inv.pickProduct,
  hide,
  testID = 'pick-product',
}: {
  businessId: string;
  onPick: (p: Product) => void;
  label?: string;
  /** Món không hiện trong kết quả (đã có trong phiếu) */
  hide?: Set<string>;
  testID?: string;
}) {
  const products = useProducts(businessId);
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState<string | null>(null);
  const waiting = useRef(false);
  const scanned = useScanResult((s) => s.code);
  const clearScan = useScanResult((s) => s.set);
  useEffect(() => {
    if (!waiting.current || !scanned || !products.data) return;
    waiting.current = false;
    clearScan(null);
    const p = findByBarcode<Product>(products.data, scanned);
    if (p) {
      setMiss(null);
      onPick(p);
    } else setMiss(vi.catalog.notFoundCode(scanned));
  }, [scanned, products.data, clearScan, onPick]);

  const all = (products.data ?? []).filter((p) => !hide?.has(p.id));
  const shown = query.trim() ? all.filter((p) => matchProduct(p, query)).slice(0, 8) : [];
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field label={label} value={query} onChangeText={setQuery} maxLength={64} testID={testID} placeholder={vi.catalog.search} />
        </View>
        <Button
          kind="secondary"
          label={vi.catalog.scan}
          onPress={() => {
            waiting.current = true;
            clearScan(null);
            router.push({ pathname: '/quet-ma', params: { mode: 'fill' } });
          }}
        />
      </View>
      {miss ? <Txt tone="warn">{miss}</Txt> : null}
      {query.trim() && shown.length === 0 ? <Txt tone="secondary">{vi.catalog.noMatch}</Txt> : null}
      {shown.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={`${p.name}, ${formatVND(p.price)}`}
          testID={`pick-${p.name}`}
          onPress={() => {
            setQuery('');
            setMiss(null);
            onPick(p);
          }}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{p.name}</Txt>
              <Txt variant="small" tone="secondary">
                {[`${formatVND(p.price)} / ${p.unit}`, p.track_stock ? vi.catalog.stockLeft(formatQty(p.stock_qty), p.unit) : null, p.barcode]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
            </View>
            <Txt variant="title" tone="primary">
              +
            </Txt>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}
