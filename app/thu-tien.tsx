import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackLink, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { Keypad } from '../src/components/Keypad';
import { ErrorView, OfflineBanner } from '../src/components/States';
import { useSale, useAmount, quickItems } from '../src/features/sale/store';
import { createOrder } from '../src/features/sale/api';
import { applyOrderUpdate } from '../src/features/sale/realtime';
import { PaymentPanel } from '../src/features/sale/PaymentPanel';
import { useBusinessId } from '../src/features/session/store';
import { useMainAccount } from '../src/features/session/hooks';
import { useQueue } from '../src/features/offline/useQueue';
import { useNet } from '../src/lib/net';
import { deviceIdSync, newId } from '../src/lib/device';
import { toAppError } from '../src/lib/errors';
import { capitalize, formatVND, readVND } from '../src/lib/money';
import { layoutFor } from '../src/theme/layout';
import { colors, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/**
 * 2.2 Nhập số tiền. Một cột (< 600dp): bấm "Hiện mã QR" → /cho-tien/[id].
 * Hai cột (≥ 600dp): bàn phím trái, mã QR / kết quả phải (6.5, 6.6) — không chuyển màn hình.
 * Số đang nhập và đơn đang chờ nằm trong store: gập/mở máy không mất.
 */
export default function ThuTien() {
  const { width, height, fontScale } = useWindowDimensions();
  const L = layoutFor(width, height, fontScale);
  const insets = useSafeAreaInsets();
  const businessId = useBusinessId();
  const press = useSale((s) => s.press);
  const activeOrderId = useSale((s) => s.activeOrderId);
  const amount = useAmount();
  const online = useNet((s) => s.online);
  const account = useMainAccount(businessId);
  const queued = useQueue((s) => s.items.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const hasAccount = !!account.data;
  const canQr = amount > 0 && online && hasAccount;
  const qrDisabledLabel = amount <= 0 ? vi.sale.enterFirst : !online ? vi.sale.qrNeedsNetwork : vi.sale.qrNeedsAccount;

  const showQr = async () => {
    setError(null);
    setBusy(true);
    const sale = useSale.getState();
    // Mã đơn sinh một lần cho số tiền này: thử lại dùng lại mã → không tạo đơn trùng
    let orderId = sale.pendingOrderId ?? newId();
    sale.setPending(orderId);
    try {
      let order;
      try {
        order = await createOrder({ orderId, businessId, items: quickItems(amount), deviceId: deviceIdSync() });
      } catch (e) {
        if (toAppError(e).code !== 'QP_ORDER_CONFLICT') throw e;
        orderId = newId();
        sale.setPending(orderId);
        order = await createOrder({ orderId, businessId, items: quickItems(amount), deviceId: deviceIdSync() });
      }
      applyOrderUpdate(order);
      sale.setActive(order.id);
      sale.setPending(null);
      if (L.kind !== 'split') router.push({ pathname: '/cho-tien/[id]', params: { id: order.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const newSale = () => useSale.getState().newSale();

  const amountBlock = (
    <Card style={{ alignItems: 'center', gap: 4, paddingVertical: L.kind === 'compact' ? space.md : space.xl }}>
      <Txt variant="bodyStrong" tone="secondary">
        {vi.sale.due}
      </Txt>
      <Amount value={formatVND(amount)} size={L.amountSize} tone={amount > 0 ? 'ink' : 'secondary'} />
      <Txt tone="secondary" center numberOfLines={2}>
        {amount > 0 ? capitalize(readVND(amount)) : vi.sale.noAmount}
      </Txt>
    </Card>
  );

  const actions = (
    <View style={{ gap: space.md }}>
      {error ? <ErrorView error={error} /> : null}
      <Button big label={vi.sale.showQr} onPress={showQr} busy={busy} disabled={!canQr} disabledLabel={qrDisabledLabel} />
      <Button
        kind={L.secondaryAsLink ? 'link' : 'secondary'}
        label={vi.sale.payCash}
        disabled={amount <= 0}
        disabledLabel={vi.sale.enterFirst}
        onPress={() => router.push('/tien-mat')}
      />
    </View>
  );

  // Một cột: còn đơn đang chờ (ví dụ vừa gập máy từ hai cột) → nhắc mở lại, không mất đơn
  const resumeBanner =
    L.kind !== 'split' && activeOrderId ? (
      <Button kind="secondary" label={`${vi.sale.scanToPay} ›`} onPress={() => router.push({ pathname: '/cho-tien/[id]', params: { id: activeOrderId } })} />
    ) : null;

  const left = (
    <View style={{ gap: L.kind === 'compact' ? space.sm : space.md }}>
      <OfflineBanner queued={queued} />
      {resumeBanner}
      {amountBlock}
      <Keypad onKey={press} keyHeight={L.keyHeight} />
      {actions}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      {L.kind === 'split' ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: space.gutter, padding: space.gutter, paddingTop: space.sm }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.md, paddingBottom: insets.bottom + space.lg }}>
            <BackLink label={vi.common.home} href="/trang-chinh" />
            {left}
          </ScrollView>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.md, paddingBottom: insets.bottom + space.lg, flexGrow: 1 }}>
            {activeOrderId ? (
              <PaymentPanel orderId={activeOrderId} qrSize={L.qrSize} onNewSale={newSale} />
            ) : (
              <Card style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' }}>
                <Txt tone="secondary" center variant="bodyStrong">
                  {vi.sale.showQr}
                </Txt>
              </Card>
            )}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.gutter, paddingTop: space.sm, gap: space.sm, paddingBottom: insets.bottom + space.lg }}>
          <BackLink label={vi.common.home} href="/trang-chinh" />
          {left}
        </ScrollView>
      )}
    </View>
  );
}
