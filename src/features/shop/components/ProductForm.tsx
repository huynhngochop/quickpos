import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Txt } from '../../../components/Txt';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Choice';
import { Checkbox, ErrorView } from '../../../components/States';
import { upsertProduct } from '../api';
import { formatQty, useScanResult } from '../hooks';
import { cleanCode } from '../inventory';
import { formatVND } from '../../../lib/money';
import { newId } from '../../../lib/device';
import { space } from '../../../theme/tokens';
import { vi } from '../../../i18n/vi';
import type { Product } from '../../../types/api';

const money = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);
const qtyText = (s: string) => s.replace(/[^\d,]/g, '').replace(/,(?=.*,)/g, '').slice(0, 10);
const parseQty = (s: string) => Number(s.replace(',', '.') || '0');

/**
 * Form thêm/sửa món dùng chung (6.1 Thêm món, 6.2 Sửa món): tên, giá, đơn vị, nhóm, mã vạch (quét hoặc gõ),
 * giá nhập, theo dõi tồn kho, hàng có hạn dùng + số ngày báo trước.
 */
export function ProductForm({
  businessId,
  initial,
  initialBarcode,
  onSaved,
}: {
  businessId: string;
  initial?: Product;
  initialBarcode?: string;
  onSaved: (p: Product) => void;
}) {
  const qc = useQueryClient();
  const productId = useRef(initial?.id ?? newId());
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? String(initial.price) : '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [barcode, setBarcode] = useState(initial?.barcode ?? initialBarcode ?? '');
  const [cost, setCost] = useState(initial?.cost_price != null ? String(initial.cost_price) : '');
  const [track, setTrack] = useState(initial?.track_stock ?? false);
  const [low, setLow] = useState(initial?.low_stock_at != null ? formatQty(initial.low_stock_at) : '');
  const [expiry, setExpiry] = useState(initial?.track_expiry ?? false);
  const [warn, setWarn] = useState(String(initial?.expiry_warn_days ?? 7));
  const [problem, setProblem] = useState<string | null>(null);

  // Mã quét ở màn /quet-ma (chế độ điền) quay về đây
  const waitingScan = useRef(false);
  const scanned = useScanResult((s) => s.code);
  const clearScan = useScanResult((s) => s.set);
  useEffect(() => {
    if (waitingScan.current && scanned) {
      setBarcode(scanned);
      waitingScan.current = false;
      clearScan(null);
    }
  }, [scanned, clearScan]);

  const save = useMutation({
    mutationFn: () =>
      upsertProduct({
        productId: productId.current, businessId, name: name.trim(), price: Number(price || '0'),
        unit: unit.trim() || vi.catalog.defaultUnit, category: category.trim() || null, costPrice: cost ? Number(cost) : null,
        trackStock: track || expiry, lowStockAt: (track || expiry) && low ? parseQty(low) : null,
        barcode: cleanCode(barcode) || null, trackExpiry: expiry, expiryWarnDays: Number(warn || '7'),
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['products', businessId] });
      if (!initial) productId.current = newId();
      onSaved(p);
    },
  });

  const submit = () => {
    if (!name.trim()) return setProblem(vi.catalog.enterName);
    if (!price) return setProblem(vi.catalog.enterPrice);
    const w = Number(warn || '0');
    if (expiry && !(w >= 1 && w <= 365)) return setProblem(vi.catalog.enterWarnDays);
    setProblem(null);
    save.mutate();
  };

  return (
    <View style={{ gap: space.md }}>
      <Field label={vi.catalog.name} value={name} onChangeText={setName} maxLength={100} testID="product-name" />
      <Field label={vi.catalog.price} value={price} onChangeText={(v) => setPrice(money(v))} keyboardType="number-pad" testID="product-price" />
      {price ? <Txt tone="secondary">{formatVND(Number(price))}</Txt> : null}
      <Field label={vi.catalog.unit} value={unit} onChangeText={setUnit} maxLength={20} testID="product-unit" placeholder={vi.catalog.unitHint} />
      <Field label={vi.catalog.category} value={category} onChangeText={setCategory} maxLength={50} testID="product-category" placeholder={vi.catalog.categoryHint} />
      <Field label={vi.catalog.barcode} value={barcode} onChangeText={(v) => setBarcode(v.slice(0, 64))} maxLength={64} testID="product-barcode" placeholder={vi.catalog.barcodeHint} />
      <Button
        kind="secondary"
        label={vi.catalog.scan}
        onPress={() => {
          waitingScan.current = true;
          clearScan(null);
          router.push({ pathname: '/quet-ma', params: { mode: 'fill' } });
        }}
      />
      <Field label={vi.catalog.costPrice} value={cost} onChangeText={(v) => setCost(money(v))} keyboardType="number-pad" testID="product-cost" />
      <Checkbox label={vi.catalog.trackStock} value={track || expiry} onChange={setTrack} />
      {track || expiry ? (
        <Field label={vi.catalog.lowAtShort} value={low} onChangeText={(v) => setLow(qtyText(v))} keyboardType="decimal-pad" testID="product-low" />
      ) : null}
      <Checkbox label={vi.catalog.trackExpiry} value={expiry} onChange={setExpiry} />
      {expiry ? (
        <Field label={vi.catalog.warnDays} value={warn} onChangeText={(v) => setWarn(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" testID="product-warn-days" />
      ) : null}
      {problem ? (
        <Txt tone="danger" variant="bodyStrong">
          {problem}
        </Txt>
      ) : null}
      {save.error ? <ErrorView error={save.error} /> : null}
      <Button big label={vi.catalog.save} onPress={submit} busy={save.isPending} />
    </View>
  );
}
