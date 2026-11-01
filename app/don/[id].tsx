import { useRef, useState } from 'react';
import { Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { ErrorView, Loading } from '../../src/components/States';
import { useBusinessId, useSession } from '../../src/features/session/store';
import { createInvoiceFromOrder, getOrder, invoiceForOrder, issueEinvoice, orderItems } from '../../src/features/shop/api';
import { useCustomers, formatQty } from '../../src/features/shop/hooks';
import { receiptHtml, receiptText } from '../../src/features/receipt/receipt';
import { printHtml } from '../../src/features/receipt/print';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { formatDateVN, formatTimeVN } from '../../src/lib/time';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

const TAX = /^[0-9]{10}([0-9]{2}|-[0-9]{3})?$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 3.8 Chi tiết đơn: món, gửi/in biên nhận, gắn khách quen, xuất hóa đơn điện tử. */
export default function ChiTietDon() {
  const { id, given } = useLocalSearchParams<{ id: string; given?: string }>();
  const businessId = useBusinessId();
  const business = useSession((s) => s.business);
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => getOrder(id) });
  const items = useQuery({ queryKey: ['order-items', id], queryFn: () => orderItems(id) });
  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => invoiceForOrder(id) });
  const customers = useCustomers(businessId);
  const [buyer, setBuyer] = useState({ name: '', tax: '', email: '' });
  const [askBuyer, setAskBuyer] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const invoiceId = useRef(newId());

  const o = order.data;
  const customerName = o?.customer_id ? customers.data?.find((c) => c.id === o.customer_id)?.display_name ?? null : null;
  const providerOn = (business?.einvoice_provider ?? 'NONE') !== 'NONE';
  const receipt = o && items.data
    ? {
        shopName: business?.business_name ?? '',
        shopAddress: business?.address,
        orderCode: o.order_code,
        soldAt: o.sold_at,
        method: o.payment_method,
        items: items.data.map((i) => ({ name: i.name, quantity: Number(i.quantity), unit_price: i.unit_price, line_amount: i.line_amount })),
        total: o.total_amount,
        received: given ? Number(given) : undefined,
        customerName,
      }
    : null;

  const issue = useMutation({
    mutationFn: async () => {
      const draft = await createInvoiceFromOrder({
        invoiceId: invoiceId.current, orderId: id, buyerName: buyer.name.trim(), buyerTaxCode: buyer.tax.trim(), buyerEmail: buyer.email.trim(),
      });
      return issueEinvoice(draft.id);
    },
    onSuccess: () => {
      setAskBuyer(false);
      void qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
  });

  const startIssue = () => {
    setProblem(null);
    if (buyer.tax && !TAX.test(buyer.tax.trim())) return setProblem(vi.order.taxWrong);
    if (buyer.email && !EMAIL.test(buyer.email.trim())) return setProblem(vi.order.emailWrong);
    issue.mutate();
  };

  const inv = invoice.data;
  const issued = inv && inv.status !== 'DRAFT' ? inv : null;

  return (
    <Screen back={{ label: vi.common.back }} maxWidth={640}>
      {order.isLoading ? <Loading /> : null}
      {order.error ? <ErrorView error={order.error} onRetry={() => void order.refetch()} /> : null}
      {o ? (
        <>
          <Txt variant="heading">{vi.order.title(o.order_code)}</Txt>
          <Txt tone="secondary">{`${formatTimeVN(o.sold_at)} ${formatDateVN(o.sold_at)} · ${vi.order.method[o.payment_method]} · ${vi.order.status[o.payment_status]}`}</Txt>
          <Card style={{ gap: space.xs }}>
            {(items.data ?? []).map((i) => (
              <View key={i.id} style={{ flexDirection: 'row', gap: space.md }}>
                <Txt style={{ flex: 1 }}>{`${formatQty(Number(i.quantity))} × ${i.name}`}</Txt>
                <Txt variant="bodyStrong">{formatVND(i.line_amount)}</Txt>
              </View>
            ))}
            <View style={{ alignItems: 'flex-end' }}>
              <Amount value={formatVND(o.total_amount)} size={font.size.amountSmall} center={false} />
            </View>
            {customerName ? <Txt tone="primary" variant="bodyStrong">{vi.order.customer(customerName)}</Txt> : null}
          </Card>

          {receipt ? (
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button kind="secondary" label={vi.order.sendReceipt} onPress={() => void Share.share({ message: receiptText(receipt) })} style={{ flex: 1 }} />
              <Button kind="secondary" label={vi.order.printReceipt} onPress={() => void printHtml(receiptHtml(receipt)).catch(() => undefined)} style={{ flex: 1 }} />
            </View>
          ) : null}

          {o.payment_status === 'PAID' && !o.customer_id ? (
            <Button kind="link" label={vi.order.addCustomer} onPress={() => router.push({ pathname: '/khach-quen', params: { pick: '1', order: id } })} />
          ) : null}

          <Txt variant="title">{vi.order.einvoice}</Txt>
          {issued ? (
            <Card tone="success" style={{ gap: space.xs }}>
              <Txt tone="success" variant="bodyStrong">
                {vi.order.issued(String(issued.invoice_no ?? '').padStart(8, '0'), issued.symbol)}
              </Txt>
              {issued.tax_authority_code ? <Txt>{vi.order.taxCodeLine(issued.tax_authority_code)}</Txt> : null}
              {issued.buyer_name ? <Txt tone="secondary">{issued.buyer_name}</Txt> : null}
            </Card>
          ) : o.payment_status !== 'PAID' ? (
            <Txt tone="secondary">{vi.order.payFirst}</Txt>
          ) : !providerOn ? (
            <>
              <Txt tone="secondary">{vi.order.setupFirst}</Txt>
              <Button kind="link" label={vi.order.goSetup} onPress={() => router.push('/hoa-don')} />
            </>
          ) : askBuyer ? (
            <Card style={{ gap: space.md }}>
              <Txt tone="secondary">{vi.order.buyerHint}</Txt>
              <Field label={vi.order.buyerName} value={buyer.name} onChangeText={(v) => setBuyer({ ...buyer, name: v })} maxLength={200} testID="buyer-name" />
              <Field label={vi.order.buyerTax} value={buyer.tax} onChangeText={(v) => setBuyer({ ...buyer, tax: v.replace(/[^\d-]/g, '') })} keyboardType="number-pad" maxLength={14} testID="buyer-tax" />
              <Field label={vi.order.buyerEmail} value={buyer.email} onChangeText={(v) => setBuyer({ ...buyer, email: v })} keyboardType="email-address" maxLength={120} testID="buyer-email" />
              {problem ? <Txt tone="danger" variant="bodyStrong">{problem}</Txt> : null}
              {issue.error ? <ErrorView error={issue.error} /> : null}
              <Button big label={vi.order.issueNow} onPress={startIssue} busy={issue.isPending} />
            </Card>
          ) : (
            <Button big label={vi.order.issue} onPress={() => setAskBuyer(true)} />
          )}
        </>
      ) : null}
    </Screen>
  );
}
