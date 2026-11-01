import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { useAmount, useSale, saleItems } from '../src/features/sale/store';
import { setOrderCustomer } from '../src/features/shop/api';
import { recordCashSale } from '../src/features/offline/useQueue';
import { useBusinessId } from '../src/features/session/store';
import { deviceIdSync, newId } from '../src/lib/device';
import { capitalize, cashSuggestions, formatVND, readVND, groupDigits } from '../src/lib/money';
import { colors, font, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/**
 * 2.7 Thu tiền mặt + tính tiền thối. Đơn GHI VÀO MÁY TRƯỚC rồi gửi (offline-first),
 * nên mất mạng vẫn bán được và không mất đơn.
 */
export default function TienMat() {
  const businessId = useBusinessId();
  const due = useAmount();
  // Mã đơn cố định cho màn hình này: bấm 2 lần cũng chỉ một đơn
  const orderId = useRef(newId()).current;
  const [given, setGiven] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { offline: boolean }>(null);
  const change = given !== null ? Math.max(given - due, 0) : 0;

  const confirm = async () => {
    setBusy(true);
    try {
      const { cart, customer } = useSale.getState();
      const r = await recordCashSale({ orderId, businessId, items: saleItems(due, cart), deviceId: deviceIdSync() });
      // Khách quen: cộng điểm ngay khi đơn đã lên server (mất mạng thì bỏ qua, không chặn bán hàng)
      if (r.sentNow && customer) await setOrderCustomer(orderId, customer.id).catch(() => undefined);
      setDone({ offline: !r.sentNow });
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    useSale.getState().newSale();
    router.replace('/thu-tien');
  };

  if (done) {
    return (
      <Screen footer={<Button big label={vi.paid.newOrder} onPress={next} />}>
        <Card tone={done.offline ? 'warn' : 'success'} style={{ alignItems: 'center', paddingVertical: space.xxl }}>
          <Txt variant="heading" tone={done.offline ? 'warn' : 'success'} center accessibilityLiveRegion="polite">
            {done.offline ? vi.cash.savedOffline : vi.cash.saved}
          </Txt>
          <Amount value={formatVND(due)} />
          {change > 0 ? <Txt variant="title" center>{`${vi.cash.change}: ${formatVND(change)}`}</Txt> : null}
        </Card>
        {!done.offline ? (
          <Button kind="secondary" label={vi.order.receiptBtn} onPress={() => router.push({ pathname: '/don/[id]', params: { id: orderId, given: String(given ?? due) } })} />
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      back={{ label: vi.common.back }}
      footer={<Button big kind="success" label={vi.cash.confirm} onPress={confirm} busy={busy} disabled={due <= 0} />}
    >
      <Card style={{ alignItems: 'center' }}>
        <Txt variant="bodyStrong" tone="secondary">
          {vi.sale.due}
        </Txt>
        <Amount value={formatVND(due)} size={font.size.amount} />
      </Card>
      <Txt variant="title">{vi.cash.given}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {cashSuggestions(due).map((v, i) => {
          const on = given === v;
          return (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setGiven(v)}
              style={{
                flexBasis: '47%',
                flexGrow: 1,
                minHeight: 64,
                borderRadius: radius.md,
                borderWidth: on ? 3 : 2,
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primarySoft : colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Txt variant="title">{i === 0 ? vi.cash.exact : groupDigits(v)}</Txt>
            </Pressable>
          );
        })}
      </View>
      {given !== null ? (
        <Card tone={change > 0 ? 'info' : 'plain'} style={{ alignItems: 'center' }}>
          <Txt variant="bodyStrong" tone={change > 0 ? 'primary' : 'secondary'}>
            {change > 0 ? vi.cash.change : vi.cash.noChange}
          </Txt>
          {change > 0 ? (
            <>
              <Amount value={formatVND(change)} size={font.size.amount} tone="primary" />
              <Txt tone="primary" center>
                {capitalize(readVND(change))}
              </Txt>
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
