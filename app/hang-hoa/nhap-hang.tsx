import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { Checkbox, ErrorView } from '../../src/components/States';
import { useBusinessId } from '../../src/features/session/store';
import { createPurchase } from '../../src/features/shop/api';
import { ProductPicker, SupplierPicker } from '../../src/features/shop/components/Pickers';
import { ExpiryQuick } from '../../src/features/shop/components/ExpiryQuick';
import { maskDate, parseDateVN } from '../../src/features/shop/inventory';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';
import type { Product } from '../../src/types/api';

const money = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);
const qtyText = (s: string) => s.replace(/[^\d,]/g, '').replace(/,(?=.*,)/g, '').slice(0, 10);
const parseQty = (s: string) => Number(s.replace(',', '.') || '0');

interface Line {
  id: string;
  product: Product;
  qty: string;
  cost: string;
  expires: string;
}

/**
 * 6.7 Phiếu nhập: một lần nhập nhiều món từ một nhà cung cấp. Mỗi dòng thành một lô (giá nhập, hạn dùng).
 * Trả ngay một phần → phần còn lại ghi nợ nhà cung cấp. Hàng có hạn dùng bắt buộc nhập ngày hết hạn.
 */
export default function NhapHang() {
  const params = useLocalSearchParams<{ supplier?: string }>();
  const businessId = useBusinessId();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState<string | null>(params.supplier ?? null);
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState('');
  const [toExpense, setToExpense] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const purchaseId = useRef(newId());

  const addLine = useCallback((p: Product) => {
    setDone(null);
    setLines((ls) =>
      ls.some((l) => l.product.id === p.id)
        ? ls
        : [...ls, { id: newId(), product: p, qty: '', cost: p.cost_price != null ? String(p.cost_price) : '', expires: '' }],
    );
  }, []);
  const patch = (id: string, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...v } : l)));
  const total = lines.reduce((t, l) => t + (l.cost && l.qty ? Math.round(parseQty(l.qty) * Number(l.cost)) : 0), 0);
  const paidNow = supplierId ? (paid === '' ? total : Number(paid)) : total;

  const save = useMutation({
    mutationFn: () =>
      createPurchase({
        purchaseId: purchaseId.current, businessId, supplierId, paidAmount: paidNow, recordExpense: toExpense && total > 0,
        lines: lines.map((l) => ({
          movement_id: l.id, product_id: l.product.id, qty: parseQty(l.qty), unit_cost: l.cost === '' ? null : Number(l.cost),
          expires_on: l.expires ? parseDateVN(l.expires) : null,
        })),
      }),
    onSuccess: () => {
      setDone(vi.inv.purchaseDone(lines.length));
      purchaseId.current = newId();
      setLines([]);
      setPaid('');
      for (const k of ['products', 'suppliers', 'stock-report', 'expenses', 'lots', 'movements']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });

  const submit = () => {
    setProblem(null);
    for (const l of lines) {
      const q = parseQty(l.qty);
      const day = l.expires ? parseDateVN(l.expires) : null;
      if (!(q > 0) || (l.product.track_expiry && !day) || (l.expires && !day)) return setProblem(vi.inv.lineProblem(l.product.name));
    }
    if (supplierId && paidNow > total) return setProblem(vi.inv.paidTooMuch);
    save.mutate();
  };

  const hide = new Set(lines.map((l) => l.product.id));
  return (
    <Screen
      back={{ label: vi.catalog.title, href: '/hang-hoa' }}
      maxWidth={720}
      footer={
        lines.length > 0 ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Txt variant="bodyStrong" tone="secondary" style={{ flex: 1 }}>
                {vi.inv.purchaseTotal('')}
              </Txt>
              <Amount value={formatVND(total)} size={font.size.amountSmall} center={false} />
            </View>
            <Button big label={vi.inv.savePurchase} onPress={submit} busy={save.isPending} testID="save-purchase" />
          </>
        ) : undefined
      }
    >
      <Txt variant="heading">{vi.inv.purchaseTitle}</Txt>
      <Txt tone="secondary">{vi.inv.purchaseHelp}</Txt>
      {done ? (
        <Card tone="success">
          <Txt tone="success" variant="bodyStrong">{`✓ ${done}`}</Txt>
        </Card>
      ) : null}
      <SupplierPicker businessId={businessId} value={supplierId} onChange={setSupplierId} />
      <ProductPicker businessId={businessId} onPick={addLine} hide={hide} label={vi.inv.addLine} testID="purchase-search" />
      {lines.length === 0 ? <Txt tone="secondary">{vi.inv.linesEmpty}</Txt> : null}
      {lines.map((l) => (
        <Card key={l.id} style={{ gap: space.sm }}>
          <Txt variant="title">{l.product.name}</Txt>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Field label={vi.inv.lineQty(l.product.unit)} value={l.qty} onChangeText={(v) => patch(l.id, { qty: qtyText(v) })} keyboardType="decimal-pad" testID={`line-qty-${l.product.name}`} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={vi.inv.lineCost} value={l.cost} onChangeText={(v) => patch(l.id, { cost: money(v) })} keyboardType="number-pad" testID={`line-cost-${l.product.name}`} />
            </View>
          </View>
          {l.cost && l.qty ? <Txt tone="secondary">{vi.catalog.inTotal(formatVND(Math.round(parseQty(l.qty) * Number(l.cost))))}</Txt> : null}
          {l.product.track_expiry ? (
            <>
              <Field
                label={vi.inv.lineExpiry}
                value={l.expires}
                onChangeText={(v) => patch(l.id, { expires: maskDate(v) })}
                keyboardType="number-pad"
                maxLength={10}
                testID={`line-expiry-${l.product.name}`}
              />
              {!l.expires ? <Txt tone="warn">{vi.inv.lineExpiryNeeded}</Txt> : null}
              <ExpiryQuick onPick={(d) => patch(l.id, { expires: d })} />
            </>
          ) : null}
          <Button kind="link" label={vi.inv.removeLine} onPress={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} />
        </Card>
      ))}
      {lines.length > 0 ? (
        <Card style={{ gap: space.md }}>
          {supplierId && total > 0 ? (
            <>
              <Field label={vi.inv.paidNow} value={paid === '' ? String(total) : paid} onChangeText={(v) => setPaid(money(v))} keyboardType="number-pad" testID="purchase-paid" />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Button kind="secondary" label={vi.inv.paidAll} onPress={() => setPaid('')} style={{ flex: 1 }} />
                <Button kind="secondary" label={vi.inv.payLater} onPress={() => setPaid('0')} style={{ flex: 1 }} testID="purchase-pay-later" />
              </View>
              {total - paidNow > 0 ? <Txt tone="warn" variant="bodyStrong">{vi.inv.debtAfter(formatVND(total - paidNow))}</Txt> : null}
            </>
          ) : (
            <Txt variant="small" tone="secondary">
              {vi.inv.noSupplierPaid}
            </Txt>
          )}
          <Checkbox label={vi.catalog.toExpense} value={toExpense} onChange={setToExpense} />
          {problem ? (
            <Txt tone="danger" variant="bodyStrong">
              {problem}
            </Txt>
          ) : null}
          {save.error ? <ErrorView error={save.error} /> : null}
        </Card>
      ) : null}
      {done ? <Button kind="link" label={vi.catalog.title} onPress={() => router.replace('/hang-hoa')} /> : null}
    </Screen>
  );
}
