import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ChoiceGrid, Field } from '../../src/components/Choice';
import { Checkbox, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useProducts, formatQty } from '../../src/features/shop/hooks';
import { listMovements, setProductActive, stockCount, stockIn, upsertProduct } from '../../src/features/shop/api';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { formatDateVN, formatTimeVN } from '../../src/lib/time';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

type Tab = 'IN' | 'COUNT' | 'EDIT';
const money = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);
const qtyText = (s: string) => s.replace(/[^\d,]/g, '').replace(/,(?=.*,)/g, '').slice(0, 10);
const parseQty = (s: string) => Number(s.replace(',', '.') || '0');

/** 6.2 Một món: tồn kho, nhập hàng (ghi luôn vào chi tiêu), kiểm kho, sửa giá, ngừng bán, lịch sử kho. */
export default function MonHang() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = useBusinessId();
  const role = useSession((s) => s.role);
  const manage = canManage(role);
  const qc = useQueryClient();
  const products = useProducts(businessId, true);
  const p = (products.data ?? []).find((x) => x.id === id);
  const moves = useQuery({ queryKey: ['movements', id], queryFn: () => listMovements(id) });
  const [tab, setTab] = useState<Tab>('IN');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [toExpense, setToExpense] = useState(true);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [low, setLow] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const moveId = useRef(newId());

  useEffect(() => {
    if (p) {
      setName(p.name);
      setPrice(String(p.price));
      setLow(p.low_stock_at !== null ? formatQty(p.low_stock_at) : '');
      if (p.cost_price && !cost) setCost(String(p.cost_price));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id]);

  const refresh = () => {
    moveId.current = newId();
    setQty('');
    void qc.invalidateQueries({ queryKey: ['products', businessId] });
    void qc.invalidateQueries({ queryKey: ['movements', id] });
    void qc.invalidateQueries({ queryKey: ['expenses', businessId] });
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!p) return;
      if (tab === 'IN') {
        await stockIn({ movementId: moveId.current, productId: p.id, qty: parseQty(qty), unitCost: cost ? Number(cost) : null, recordExpense: toExpense && !!cost });
        return vi.catalog.stockInDone;
      }
      if (tab === 'COUNT') {
        await stockCount({ movementId: moveId.current, productId: p.id, actualQty: parseQty(qty) });
        return vi.catalog.countDone;
      }
      await upsertProduct({
        productId: p.id, businessId, name: name.trim(), price: Number(price || '0'), unit: p.unit, category: p.category,
        costPrice: p.cost_price, trackStock: p.track_stock, lowStockAt: low ? parseQty(low) : null,
      });
      return vi.catalog.saved;
    },
    onSuccess: (m) => {
      setMsg(m ?? null);
      refresh();
    },
  });
  const active = useMutation({
    mutationFn: () => setProductActive(id, !(p?.is_active ?? true)),
    onSuccess: refresh,
  });

  const submit = () => {
    setMsg(null);
    if (tab !== 'EDIT' && !(parseQty(qty) >= 0 && qty !== '')) return setMsg(vi.catalog.enterQty);
    if (tab === 'IN' && parseQty(qty) <= 0) return setMsg(vi.catalog.enterQty);
    mut.mutate();
  };

  return (
    <Screen back={{ label: vi.catalog.title, href: '/hang-hoa' }} maxWidth={720}>
      {products.isLoading ? <Loading /> : null}
      {p ? (
        <>
          <Txt variant="heading">{p.name}</Txt>
          <Txt tone="secondary">{`${formatVND(p.price)} / ${p.unit}${p.category ? ` · ${p.category}` : ''}`}</Txt>
          <Card style={{ alignItems: 'center' }}>
            <Txt variant="bodyStrong" tone="secondary">
              {vi.catalog.inStock}
            </Txt>
            <Amount value={p.track_stock ? `${formatQty(p.stock_qty)} ${p.unit}` : vi.catalog.notTracked} size={font.size.amountSmall} />
          </Card>

          <ChoiceGrid
            options={[
              { key: 'IN' as Tab, label: vi.catalog.tabIn },
              ...(manage ? [{ key: 'COUNT' as Tab, label: vi.catalog.tabCount }, { key: 'EDIT' as Tab, label: vi.catalog.tabEdit }] : []),
            ]}
            value={tab}
            onChange={(t) => {
              setTab(t);
              setMsg(null);
            }}
            columns={3}
            testIdPrefix="product-tab"
          />
          <Card style={{ gap: space.md }}>
            {tab === 'IN' ? (
              <>
                <Field label={vi.catalog.qtyIn(p.unit)} value={qty} onChangeText={(v) => setQty(qtyText(v))} keyboardType="decimal-pad" testID="stock-qty" />
                <Field label={vi.catalog.unitCost} value={cost} onChangeText={(v) => setCost(money(v))} keyboardType="number-pad" testID="stock-cost" />
                {cost && qty ? <Txt tone="secondary">{vi.catalog.inTotal(formatVND(Math.round(parseQty(qty) * Number(cost))))}</Txt> : null}
                <Checkbox label={vi.catalog.toExpense} value={toExpense} onChange={setToExpense} />
              </>
            ) : tab === 'COUNT' ? (
              <Field label={vi.catalog.qtyCounted(p.unit)} value={qty} onChangeText={(v) => setQty(qtyText(v))} keyboardType="decimal-pad" testID="stock-qty" />
            ) : (
              <>
                <Field label={vi.catalog.name} value={name} onChangeText={setName} maxLength={100} />
                <Field label={vi.catalog.price} value={price} onChangeText={(v) => setPrice(money(v))} keyboardType="number-pad" />
                <Field label={vi.catalog.lowAt(p.unit)} value={low} onChangeText={(v) => setLow(qtyText(v))} keyboardType="decimal-pad" />
              </>
            )}
            {msg ? (
              <Txt tone={mut.isSuccess ? 'success' : 'danger'} variant="bodyStrong">
                {msg}
              </Txt>
            ) : null}
            {mut.error ? <ErrorView error={mut.error} /> : null}
            <Button big label={tab === 'IN' ? vi.catalog.saveIn : tab === 'COUNT' ? vi.catalog.saveCount : vi.catalog.save} onPress={submit} busy={mut.isPending} />
          </Card>

          {manage ? (
            <Button kind={p.is_active ? 'dangerOutline' : 'secondary'} label={p.is_active ? vi.catalog.stopSelling : vi.catalog.resumeSelling} onPress={() => active.mutate()} busy={active.isPending} />
          ) : null}

          <Txt variant="title">{vi.catalog.history}</Txt>
          {(moves.data ?? []).map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', gap: space.md }}>
              <Txt style={{ flex: 1 }}>
                {`${formatDateVN(m.created_at)} ${formatTimeVN(m.created_at)} · ${vi.catalog.moveKind[m.kind]}${m.note ? ` · ${m.note}` : ''}`}
              </Txt>
              <Txt variant="bodyStrong" tone={m.qty < 0 ? 'warn' : 'success'}>
                {`${m.qty > 0 ? '+' : ''}${formatQty(m.qty)}`}
              </Txt>
            </View>
          ))}
          {moves.data && moves.data.length === 0 ? <Txt tone="secondary">{vi.catalog.noHistory}</Txt> : null}
        </>
      ) : null}
    </Screen>
  );
}
