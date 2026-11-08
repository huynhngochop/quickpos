import { useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { Checkbox, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { formatQty, useSupplierDetail } from '../../src/features/shop/hooks';
import { archiveSupplier, paySupplier, voidSupplierPayment } from '../../src/features/shop/api';
import { dayToVN } from '../../src/features/shop/inventory';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';
import type { SupplierPayment } from '../../src/types/api';

const money = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);

/** 6.6c Một nhà cung cấp: còn nợ bao nhiêu, trả nợ, các lần nhập / trả, hàng do họ giao. */
export default function MotNhaCungCap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const qc = useQueryClient();
  const d = useSupplierDetail(businessId, id);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [toExpense, setToExpense] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [askVoid, setAskVoid] = useState<SupplierPayment | null>(null);
  const [askHide, setAskHide] = useState(false);
  const payId = useRef(newId());

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['suppliers', businessId] });
    void qc.invalidateQueries({ queryKey: ['expenses', businessId] });
  };
  const pay = useMutation({
    mutationFn: () => paySupplier({ paymentId: payId.current, supplierId: id, amount: Number(amount), note: note.trim() || null, recordExpense: toExpense }),
    onSuccess: () => {
      payId.current = newId();
      setAmount('');
      setNote('');
      setMsg({ text: vi.inv.payDone, ok: true });
      refresh();
    },
  });
  const voidPay = useMutation({
    mutationFn: (p: SupplierPayment) => voidSupplierPayment(p.id),
    onSuccess: () => {
      setAskVoid(null);
      refresh();
    },
  });
  const hide = useMutation({
    mutationFn: () => archiveSupplier(id),
    onSuccess: () => {
      setAskHide(false);
      refresh();
      router.replace('/nha-cung-cap');
    },
  });

  const data = d.data;
  const s = data?.supplier;
  return (
    <Screen back={{ label: vi.inv.suppliers, href: '/nha-cung-cap' }} maxWidth={720}>
      {d.isLoading ? <Loading /> : null}
      {d.error ? <ErrorView error={d.error} onRetry={() => void d.refetch()} /> : null}
      {data && s ? (
        <>
          <Txt variant="heading">{s.name}</Txt>
          <Txt tone="secondary">{[s.phone, s.address, s.tax_code].filter(Boolean).join(' · ')}</Txt>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            {s.phone ? <Button kind="secondary" label={vi.inv.call} onPress={() => void Linking.openURL(`tel:${s.phone}`)} style={{ flex: 1 }} /> : null}
            {manage ? (
              <Button kind="secondary" label={vi.inv.editSupplier} onPress={() => router.push({ pathname: '/nha-cung-cap/them', params: { id } })} style={{ flex: 1 }} />
            ) : null}
          </View>
          <Card style={{ alignItems: 'center', gap: space.xs }} tone={data.balance > 0 ? 'warn' : undefined}>
            <Txt variant="bodyStrong" tone="secondary">
              {data.balance > 0 ? vi.inv.owe('') : data.balance < 0 ? vi.inv.prepaid('') : vi.inv.oweNone}
            </Txt>
            {data.balance !== 0 ? <Amount value={formatVND(Math.abs(data.balance))} size={font.size.amountSmall} /> : null}
            <Txt variant="small" tone="secondary">
              {vi.inv.purchasedPaid(formatVND(data.purchased), formatVND(data.paid))}
            </Txt>
          </Card>

          {manage && data.balance > 0 ? (
            <Card style={{ gap: space.md }}>
              <Txt variant="title">{vi.inv.pay}</Txt>
              <Field label={vi.inv.payAmount} value={amount} onChangeText={(v) => setAmount(money(v))} keyboardType="number-pad" testID="supplier-pay" />
              {amount ? <Txt tone="secondary">{formatVND(Number(amount))}</Txt> : null}
              <Button kind="link" label={`${vi.inv.payAll} (${formatVND(data.balance)})`} onPress={() => setAmount(String(data.balance))} />
              <Field label={vi.inv.payNote} value={note} onChangeText={setNote} maxLength={200} />
              <Checkbox label={vi.inv.payToExpense} value={toExpense} onChange={setToExpense} />
              {msg ? <Txt tone={msg.ok ? 'success' : 'danger'} variant="bodyStrong">{msg.ok ? `✓ ${msg.text}` : msg.text}</Txt> : null}
              {pay.error ? <ErrorView error={pay.error} /> : null}
              <Button
                big
                label={vi.inv.pay}
                busy={pay.isPending}
                onPress={() => {
                  if (!(Number(amount) > 0)) return setMsg({ text: vi.inv.enterPay, ok: false });
                  setMsg(null);
                  pay.mutate();
                }}
              />
            </Card>
          ) : msg ? (
            <Txt tone="success" variant="bodyStrong">{`✓ ${msg.text}`}</Txt>
          ) : null}

          <Button kind="secondary" label={vi.inv.newPurchase} onPress={() => router.push({ pathname: '/hang-hoa/nhap-hang', params: { supplier: id } })} />

          <Txt variant="title">{vi.inv.supplied}</Txt>
          {data.products.length === 0 ? <Txt tone="secondary">{vi.inv.suppliedNone}</Txt> : null}
          {data.products.map((p) => (
            <Card key={p.product_id} style={{ gap: space.xs }}>
              <Button kind="link" label={p.name} onPress={() => router.push({ pathname: '/hang-hoa/[id]', params: { id: p.product_id } })} />
              <Txt variant="small" tone="secondary">
                {vi.inv.suppliedLine(formatQty(p.qty_total), p.unit, p.last_cost != null ? formatVND(p.last_cost) : null, p.last_on ? dayToVN(p.last_on) : '')}
              </Txt>
            </Card>
          ))}

          <Txt variant="title">{vi.inv.purchases}</Txt>
          {data.purchases.map((x) => (
            <Txt key={x.id}>
              {`${vi.inv.purchaseLine(dayToVN(x.purchased_on), x.line_count, formatVND(x.total_amount))}${x.paid_amount > 0 ? ` · ${vi.inv.purchasePaid(formatVND(x.paid_amount))}` : ''}`}
            </Txt>
          ))}

          <Txt variant="title">{vi.inv.payments}</Txt>
          {data.payments.map((x) => (
            <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Txt style={{ flex: 1, opacity: x.voided_at ? 0.5 : 1 }}>
                {[vi.inv.paymentLine(dayToVN(x.paid_on), formatVND(x.amount)), x.note, x.voided_at ? vi.inv.voided : null].filter(Boolean).join(' · ')}
              </Txt>
              {manage && !x.voided_at ? <Button kind="link" label={vi.inv.voidPayment} onPress={() => setAskVoid(x)} /> : null}
            </View>
          ))}
          {voidPay.error ? <ErrorView error={voidPay.error} /> : null}
          {manage ? <Button kind="dangerOutline" label={vi.inv.hideSupplier} onPress={() => setAskHide(true)} /> : null}
          {hide.error ? <ErrorView error={hide.error} /> : null}

          <ConfirmSheet
            visible={!!askVoid}
            title={askVoid ? vi.inv.voidAsk(formatVND(askVoid.amount)) : ''}
            body={vi.inv.voidBody}
            yes={vi.inv.voidYes}
            no={vi.common.back}
            danger
            busy={voidPay.isPending}
            onYes={() => askVoid && voidPay.mutate(askVoid)}
            onNo={() => setAskVoid(null)}
          />
          <ConfirmSheet
            visible={askHide}
            title={vi.inv.hideSupplierAsk(s.name)}
            body={vi.inv.hideSupplierBody}
            yes={vi.inv.hideSupplierYes}
            no={vi.common.back}
            danger
            busy={hide.isPending}
            onYes={() => hide.mutate()}
            onNo={() => setAskHide(false)}
          />
        </>
      ) : null}
    </Screen>
  );
}
