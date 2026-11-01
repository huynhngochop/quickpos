import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ChoiceGrid, Field } from '../../src/components/Choice';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { Checkbox, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useLots, useProducts, formatQty } from '../../src/features/shop/hooks';
import { deleteProduct, listMovements, setProductActive, stockCount, stockIn, stockOut } from '../../src/features/shop/api';
import { ProductForm } from '../../src/features/shop/components/ProductForm';
import { dayToVN, daysUntil, expiryTone, maskDate, parseDateVN } from '../../src/features/shop/inventory';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { formatDateVN, formatTimeVN, vnDay } from '../../src/lib/time';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';
import type { StockLot, StockOutReason } from '../../src/types/api';

type Tab = 'IN' | 'OUT' | 'COUNT' | 'EDIT';
const money = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);
const qtyText = (s: string) => s.replace(/[^\d,]/g, '').replace(/,(?=.*,)/g, '').slice(0, 10);
const parseQty = (s: string) => Number(s.replace(',', '.') || '0');

/**
 * 6.2 Một món: tồn kho, các lô còn hạn/sắp hết hạn (bỏ lô quá hạn), nhập hàng (có ngày hết hạn),
 * xuất hủy, kiểm kho, sửa món (mã vạch, hạn dùng), ngừng bán, xóa, lịch sử kho.
 */
export default function MonHang() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const qc = useQueryClient();
  const products = useProducts(businessId, true);
  const p = (products.data ?? []).find((x) => x.id === id);
  const moves = useQuery({ queryKey: ['movements', id], queryFn: () => listMovements(id) });
  const lots = useLots(id);
  const [tab, setTab] = useState<Tab>('IN');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [expires, setExpires] = useState('');
  const [toExpense, setToExpense] = useState(true);
  const [reason, setReason] = useState<StockOutReason>('EXPIRED');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [discard, setDiscard] = useState<StockLot | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const moveId = useRef(newId());
  const today = vnDay();

  useEffect(() => {
    if (p?.cost_price && !cost) setCost(String(p.cost_price));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id]);

  const refresh = () => {
    moveId.current = newId();
    setQty('');
    setExpires('');
    void qc.invalidateQueries({ queryKey: ['products', businessId] });
    void qc.invalidateQueries({ queryKey: ['movements', id] });
    void qc.invalidateQueries({ queryKey: ['lots', id] });
    void qc.invalidateQueries({ queryKey: ['stock-report', businessId] });
    void qc.invalidateQueries({ queryKey: ['expenses', businessId] });
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!p) return '';
      if (tab === 'IN') {
        await stockIn({
          movementId: moveId.current, productId: p.id, qty: parseQty(qty), unitCost: cost ? Number(cost) : null,
          recordExpense: toExpense && !!cost, expiresOn: expires ? parseDateVN(expires) : null,
        });
        return vi.catalog.stockInDone;
      }
      if (tab === 'OUT') {
        await stockOut({ movementId: moveId.current, productId: p.id, qty: parseQty(qty), reason });
        return vi.catalog.outDone;
      }
      await stockCount({ movementId: moveId.current, productId: p.id, actualQty: parseQty(qty) });
      return vi.catalog.countDone;
    },
    onSuccess: (m) => {
      setMsg({ text: m, ok: true });
      refresh();
    },
  });

  const discardLot = useMutation({
    mutationFn: (l: StockLot) => stockOut({ movementId: newId(), productId: id, qty: l.qty_left, reason: 'EXPIRED', lotId: l.id }),
    onSuccess: () => {
      setDiscard(null);
      setMsg({ text: vi.catalog.discarded, ok: true });
      refresh();
    },
  });

  const active = useMutation({ mutationFn: () => setProductActive(id, !(p?.is_active ?? true)), onSuccess: refresh });

  const remove = useMutation({
    mutationFn: () => deleteProduct(id),
    onSuccess: (r) => {
      setAskDelete(false);
      void qc.invalidateQueries({ queryKey: ['products', businessId] });
      router.replace({ pathname: '/hang-hoa', params: { msg: r } });
    },
  });

  const submit = () => {
    setMsg(null);
    const n = parseQty(qty);
    if (qty === '' || !(n >= 0) || (tab !== 'COUNT' && n <= 0)) return setMsg({ text: vi.catalog.enterQty, ok: false });
    if (tab === 'IN' && p) {
      const day = expires ? parseDateVN(expires) : null;
      if ((p.track_expiry && !day) || (expires && !day)) return setMsg({ text: vi.catalog.enterExpiry, ok: false });
    }
    mut.mutate();
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'IN', label: vi.catalog.tabIn },
    ...(manage
      ? [
          { key: 'OUT' as Tab, label: vi.catalog.tabOut },
          { key: 'COUNT' as Tab, label: vi.catalog.tabCount },
          { key: 'EDIT' as Tab, label: vi.catalog.tabEdit },
        ]
      : []),
  ];
  const lotRows = lots.data ?? [];

  return (
    <Screen back={{ label: vi.catalog.title, href: '/hang-hoa' }} maxWidth={720}>
      {products.isLoading ? <Loading /> : null}
      {products.error ? <ErrorView error={products.error} onRetry={() => void products.refetch()} /> : null}
      {p ? (
        <>
          <Txt variant="heading">{p.name}</Txt>
          <Txt tone="secondary">
            {[`${formatVND(p.price)} / ${p.unit}`, p.category, p.barcode].filter(Boolean).join(' · ')}
          </Txt>
          <Card style={{ alignItems: 'center' }}>
            <Txt variant="bodyStrong" tone="secondary">
              {vi.catalog.inStock}
            </Txt>
            <Amount value={p.track_stock ? `${formatQty(p.stock_qty)} ${p.unit}` : vi.catalog.notTracked} size={font.size.amountSmall} />
          </Card>

          {lotRows.length > 0 ? (
            <Card style={{ gap: space.sm }}>
              <Txt variant="title">{vi.catalog.lots}</Txt>
              {lotRows.map((l) => {
                const days = l.expires_on ? daysUntil(today, l.expires_on) : null;
                const tone = days === null ? 'secondary' : expiryTone(days, p.expiry_warn_days);
                return (
                  <View key={l.id} style={{ gap: space.xs }}>
                    <Txt variant="bodyStrong">
                      {l.expires_on ? vi.catalog.lotLine(formatQty(l.qty_left), p.unit, dayToVN(l.expires_on)) : vi.catalog.lotNoDate(formatQty(l.qty_left), p.unit)}
                    </Txt>
                    {days !== null ? (
                      <Txt variant="small" tone={tone}>
                        {vi.catalog.expiresIn(days)}
                      </Txt>
                    ) : null}
                    {manage && days !== null && days <= p.expiry_warn_days ? (
                      <Button kind="dangerOutline" label={vi.catalog.discardLot} onPress={() => setDiscard(l)} />
                    ) : null}
                  </View>
                );
              })}
            </Card>
          ) : null}

          <ChoiceGrid
            options={tabs}
            value={tab}
            onChange={(t) => {
              setTab(t);
              setMsg(null);
              setQty('');
            }}
            columns={2}
            testIdPrefix="product-tab"
          />
          <Card style={{ gap: space.md }}>
            {tab === 'IN' ? (
              <>
                <Field label={vi.catalog.qtyIn(p.unit)} value={qty} onChangeText={(v) => setQty(qtyText(v))} keyboardType="decimal-pad" testID="stock-qty" />
                <Field label={vi.catalog.unitCost} value={cost} onChangeText={(v) => setCost(money(v))} keyboardType="number-pad" testID="stock-cost" />
                {cost && qty ? <Txt tone="secondary">{vi.catalog.inTotal(formatVND(Math.round(parseQty(qty) * Number(cost))))}</Txt> : null}
                <Field
                  label={p.track_expiry ? vi.catalog.expiresField : vi.catalog.expiresOptional}
                  value={expires}
                  onChangeText={(v) => setExpires(maskDate(v))}
                  keyboardType="number-pad"
                  maxLength={10}
                  testID="stock-expires"
                />
                <Checkbox label={vi.catalog.toExpense} value={toExpense} onChange={setToExpense} />
              </>
            ) : tab === 'OUT' ? (
              <>
                <Field label={vi.catalog.qtyOut(p.unit)} value={qty} onChangeText={(v) => setQty(qtyText(v))} keyboardType="decimal-pad" testID="stock-qty" />
                <Txt variant="bodyStrong">{vi.catalog.outReason}</Txt>
                <ChoiceGrid
                  options={(['EXPIRED', 'DAMAGED', 'USED', 'OTHER'] as StockOutReason[]).map((k) => ({ key: k, label: vi.catalog.reasons[k] ?? k }))}
                  value={reason}
                  onChange={setReason}
                  columns={2}
                  testIdPrefix="out-reason"
                />
              </>
            ) : tab === 'COUNT' ? (
              <Field label={vi.catalog.qtyCounted(p.unit)} value={qty} onChangeText={(v) => setQty(qtyText(v))} keyboardType="decimal-pad" testID="stock-qty" />
            ) : (
              <ProductForm
                key={p.id}
                businessId={businessId}
                initial={p}
                onSaved={() => {
                  setMsg({ text: vi.catalog.saved, ok: true });
                  refresh();
                }}
              />
            )}
            {msg ? (
              <Txt tone={msg.ok ? 'success' : 'danger'} variant="bodyStrong">
                {msg.ok ? `✓ ${msg.text}` : msg.text}
              </Txt>
            ) : null}
            {mut.error ? <ErrorView error={mut.error} /> : null}
            {tab !== 'EDIT' ? (
              <Button
                big
                label={tab === 'IN' ? vi.catalog.saveIn : tab === 'OUT' ? vi.catalog.saveOut : vi.catalog.saveCount}
                onPress={submit}
                busy={mut.isPending}
              />
            ) : null}
          </Card>

          {manage ? (
            <>
              <Button
                kind="secondary"
                label={p.is_active ? vi.catalog.stopSelling : vi.catalog.resumeSelling}
                onPress={() => active.mutate()}
                busy={active.isPending}
              />
              <Button kind="dangerOutline" label={vi.catalog.deleteBtn} onPress={() => setAskDelete(true)} />
            </>
          ) : null}
          {remove.error ? <ErrorView error={remove.error} /> : null}
          {discardLot.error ? <ErrorView error={discardLot.error} /> : null}

          <Txt variant="title">{vi.catalog.history}</Txt>
          {(moves.data ?? []).map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', gap: space.md }}>
              <Txt style={{ flex: 1 }}>
                {[
                  `${formatDateVN(m.created_at)} ${formatTimeVN(m.created_at)}`,
                  m.kind === 'OUT' && m.reason ? `${vi.catalog.moveKind.OUT}: ${vi.catalog.reasons[m.reason]}` : vi.catalog.moveKind[m.kind],
                  m.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
              <Txt variant="bodyStrong" tone={m.qty < 0 ? 'warn' : 'success'}>
                {`${m.qty > 0 ? '+' : ''}${formatQty(m.qty)}`}
              </Txt>
            </View>
          ))}
          {moves.data && moves.data.length === 0 ? <Txt tone="secondary">{vi.catalog.noHistory}</Txt> : null}

          <ConfirmSheet
            visible={!!discard}
            title={discard ? vi.catalog.discardLotAsk(formatQty(discard.qty_left), p.unit, p.name) : ''}
            body={vi.catalog.discardLotBody}
            yes={vi.catalog.discardYes}
            no={vi.common.back}
            danger
            busy={discardLot.isPending}
            onYes={() => discard && discardLot.mutate(discard)}
            onNo={() => setDiscard(null)}
          />
          <ConfirmSheet
            visible={askDelete}
            title={vi.catalog.deleteAsk(p.name)}
            body={vi.catalog.deleteBody}
            yes={vi.catalog.deleteYes}
            no={vi.common.back}
            danger
            busy={remove.isPending}
            onYes={() => remove.mutate()}
            onNo={() => setAskDelete(false)}
          />
        </>
      ) : null}
    </Screen>
  );
}
