/**
 * Phần "khách trả tiền" của một đơn VietQR: chờ (2.3), chuyển thiếu (2.5), đã nhận (2.4), chuyển dư (2.6),
 * ngân hàng báo chậm (7.4), đã hủy. Dùng cho màn /cho-tien/[id] (một cột) và cột phải của /thu-tien (hai cột).
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useOrder, useQr, useCancelOrder, useManualConfirm } from './hooks';
import { paymentView } from './paymentState';
import { speakVi } from './announce';
import { useSale } from './store';
import { useSession } from '../session/store';
import { Amount, Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Card } from '../../components/Screen';
import { QrCard } from '../../components/QrCard';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { ErrorView, Loading } from '../../components/States';
import { capitalize, formatVND, readNumber, readVND } from '../../lib/money';
import { formatElapsed, formatTimeVN } from '../../lib/time';
import { colors, font, space } from '../../theme/tokens';
import { vi } from '../../i18n/vi';

/** Sau bao lâu không có báo từ ngân hàng thì hiện hướng dẫn "ngân hàng báo chậm" */
const SLOW_AFTER_S = 90;
const UNDO_MS = 5000;

export function PaymentPanel({ orderId, qrSize, onNewSale }: { orderId: string; qrSize: number; onNewSale: () => void }) {
  const order = useOrder(orderId);
  const view = order.data ? paymentView(order.data) : null;
  const missing = view?.kind === 'WAITING' ? view.total : view?.kind === 'PARTIAL' ? view.missing : null;
  const qr = useQr(orderId, missing);
  const cancel = useCancelOrder();
  const manual = useManualConfirm();
  const role = useSession((s) => s.role);
  const allowCashier = useSession((s) => s.business?.allow_cashier_manual_confirm ?? true);
  const manualAllowed = role !== 'CASHIER' || allowCashier;

  const [askCancel, setAskCancel] = useState(false);
  const [askManual, setAskManual] = useState(false);
  const [undoLeft, setUndoLeft] = useState(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Đồng hồ chờ, tính từ lúc tạo đơn
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  if (order.isLoading) return <Loading />;
  if (order.error || !order.data || !view) return <ErrorView error={order.error} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const waitedS = (now - new Date(o.created_at).getTime()) / 1000;

  // Hủy có hoàn tác 5 giây: chỉ gửi lệnh hủy sau 5 giây nếu không bấm "Hoàn tác"
  const startCancel = () => {
    setAskCancel(false);
    setUndoLeft(UNDO_MS / 1000);
    const tick = (left: number) => {
      undoTimer.current = setTimeout(() => {
        if (left <= 1) {
          setUndoLeft(0);
          cancel.mutate(o.id, { onSuccess: () => onNewSale() });
        } else {
          setUndoLeft(left - 1);
          tick(left - 1);
        }
      }, 1000);
    };
    tick(UNDO_MS / 1000);
  };
  const undo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoLeft(0);
  };

  if (undoLeft > 0) {
    return (
      <Card tone="warn" style={{ gap: space.md }}>
        <Txt variant="title" tone="warn">{`${vi.sale.cancelled} · ${undoLeft}`}</Txt>
        <Button big label={vi.sale.undo} onPress={undo} />
      </Card>
    );
  }

  const manualSheet = (
    <ConfirmSheet
      visible={askManual}
      title={vi.sale.manualAsk}
      body={vi.sale.manualAskBody}
      yes={vi.sale.manualYes}
      no={vi.sale.manualNo}
      busy={manual.isPending}
      onYes={() => manual.mutate({ orderId: o.id, note: null }, { onSettled: () => setAskManual(false) })}
      onNo={() => setAskManual(false)}
    />
  );

  switch (view.kind) {
    case 'PAID':
    case 'OVERPAID': {
      const got = view.kind === 'OVERPAID' ? view.received : view.total;
      return (
        <View style={{ gap: space.md }}>
          <View style={{ backgroundColor: colors.success, borderRadius: 20, padding: space.xl, gap: space.sm, alignItems: 'center' }} accessibilityLiveRegion="polite">
            <Txt variant="heading" tone="onColor">
              {view.kind === 'OVERPAID' ? vi.paid.receivedFull : vi.paid.received}
            </Txt>
            <Amount value={formatVND(got)} tone="onColor" size={font.size.amount} />
            <Txt variant="title" tone="onColor" center>
              {capitalize(readVND(got))}
            </Txt>
            <Txt tone="onColor">
              {view.kind === 'OVERPAID' ? vi.paid.orderOf(formatVND(view.total), formatTimeVN(o.paid_at ?? o.updated_at)) : vi.paid.at(formatTimeVN(o.paid_at ?? o.updated_at))}
            </Txt>
          </View>
          {view.kind === 'PAID' && view.manual ? (
            <Card tone="info">
              <Txt tone="primary">{vi.paid.manual}</Txt>
            </Card>
          ) : null}
          {view.kind === 'OVERPAID' ? (
            <Card tone="warn">
              <Txt variant="bodyStrong" tone="warn">{`${vi.paid.overTitle}: ${formatVND(view.over)}`}</Txt>
              <Txt tone="warn">{vi.paid.overHint(formatVND(view.over))}</Txt>
            </Card>
          ) : null}
          <Button big label={view.kind === 'OVERPAID' ? vi.paid.doneNew : vi.paid.newOrder} onPress={onNewSale} />
          <Button kind="secondary" label={vi.paid.readAgain} onPress={() => speakVi(vi.paid.speakPaid(readNumber(got)))} />
        </View>
      );
    }

    case 'CANCELLED':
      return (
        <View style={{ gap: space.md }}>
          <Card>
            <Txt variant="title">{vi.sale.cancelled}</Txt>
          </Card>
          <Button big label={vi.paid.newOrder} onPress={onNewSale} />
        </View>
      );

    case 'PARTIAL':
      return (
        <View style={{ gap: space.md }}>
          <Card tone="warn">
            <Txt variant="title" tone="warn">
              {vi.paid.partialTitle}
            </Txt>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Txt variant="small" tone="warn">
                  {vi.paid.received}
                </Txt>
                <Amount value={formatVND(view.received)} size={font.size.amountSmall} center={false} tone="warn" />
                <Txt variant="small" tone="warn">
                  {vi.paid.of(formatVND(view.total))}
                </Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="small" tone="warn">
                  {vi.paid.missing}
                </Txt>
                <Amount value={formatVND(view.missing)} size={font.size.amountSmall} center={false} tone="danger" />
                <Txt variant="small" tone="warn">
                  {capitalize(readVND(view.missing))}
                </Txt>
              </View>
            </View>
          </Card>
          <Txt variant="bodyStrong" center>
            {vi.paid.qrForMissing(formatVND(view.missing))}
          </Txt>
          <QrCard qr={qr.data} loading={qr.isLoading} error={qr.error} onRetry={() => void qr.refetch()} size={qrSize} />
          <Txt tone="secondary" center>
            {vi.paid.qrForMissingHint}
          </Txt>
          {manualAllowed ? <Button kind="success" label={vi.sale.iSawFullMoney} onPress={() => setAskManual(true)} /> : null}
          {manual.error ? <ErrorView error={manual.error} /> : null}
          {manualSheet}
        </View>
      );

    case 'WAITING':
    default: {
      const slow = waitedS > SLOW_AFTER_S;
      return (
        <View style={{ gap: space.md }}>
          <Txt variant="title" center>
            {vi.sale.scanToPay}
          </Txt>
          <Amount value={formatVND(view.total)} size={font.size.amount} />
          <QrCard qr={qr.data} loading={qr.isLoading} error={qr.error} onRetry={() => void qr.refetch()} size={qrSize} />
          {slow ? (
            <Card tone="warn">
              <Txt variant="bodyStrong" tone="warn">
                {vi.sale.slowTitle}
              </Txt>
              <Txt variant="small" tone="warn">
                {vi.sale.slowBody}
              </Txt>
              {vi.sale.slowSteps.map((s, i) => (
                <Txt key={s} variant="small" tone="warn">{`${i + 1}. ${s}`}</Txt>
              ))}
              <Txt variant="small" tone="warn">
                {vi.sale.slowWaited(formatElapsed(waitedS))}
              </Txt>
            </Card>
          ) : (
            <Txt variant="bodyStrong" tone="secondary" center accessibilityLiveRegion="polite">
              {vi.sale.waiting(formatElapsed(waitedS))}
            </Txt>
          )}
          {manualAllowed ? (
            <View style={{ gap: 4 }}>
              <Button kind="success" label={vi.sale.iSawMoney} onPress={() => setAskManual(true)} />
              <Txt variant="caption" tone="secondary" center>
                {vi.sale.iSawMoneyHint}
              </Txt>
            </View>
          ) : (
            <Txt variant="small" tone="secondary" center>
              {vi.sale.manualNotAllowed}
            </Txt>
          )}
          {manual.error ? <ErrorView error={manual.error} /> : null}
          {cancel.error ? <ErrorView error={cancel.error} /> : null}
          <Button kind="dangerOutline" label={vi.sale.cancelOrder} onPress={() => setAskCancel(true)} />
          <ConfirmSheet
            visible={askCancel}
            title={vi.sale.cancelAsk}
            body={vi.sale.cancelAskBody}
            yes={vi.sale.cancelYes}
            no={vi.sale.cancelNo}
            danger
            onYes={startCancel}
            onNo={() => setAskCancel(false)}
          />
          {manualSheet}
        </View>
      );
    }
  }
}

/** Đặt lại để bán đơn tiếp theo */
export function resetSale(): void {
  useSale.getState().newSale();
}
