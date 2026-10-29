import { useState } from 'react';
import { FlatList, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackLink, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { Empty, ErrorView, Loading, OfflineBanner } from '../src/components/States';
import { useBusinessId } from '../src/features/session/store';
import { useDayOrders, useDayTotals, useMonthTotal } from '../src/features/journal/hooks';
import { useQueue } from '../src/features/offline/useQueue';
import { paymentView } from '../src/features/sale/paymentState';
import { formatVND } from '../src/lib/money';
import { addDays, formatDayLong, formatTimeVN, vnDay } from '../src/lib/time';
import { layoutFor } from '../src/theme/layout';
import { colors, font, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';
import type { Order } from '../src/types/api';

/** 3.1 Sổ hôm nay (6.7 hai cột trên màn rộng). Danh sách phân trang keyset, tổng đọc từ bảng tổng hợp. */
export default function So() {
  const businessId = useBusinessId();
  const today = vnDay();
  const [day, setDay] = useState(today);
  const { width, height, fontScale } = useWindowDimensions();
  const L = layoutFor(width, height, fontScale);
  const insets = useSafeAreaInsets();
  const totals = useDayTotals(businessId, day);
  const month = useMonthTotal(businessId, day);
  const orders = useDayOrders(businessId, day);
  const queuedCount = useQueue((s) => s.items.length);
  const rows = orders.data?.pages.flat() ?? [];

  const dayNav = (
    <View style={{ gap: space.sm }}>
      <View style={{ alignItems: 'center' }}>
        <Txt variant="title">{day === today ? vi.journal.today : formatDayLong(day)}</Txt>
        {day === today ? (
          <Txt variant="small" tone="secondary">
            {formatDayLong(day)}
          </Txt>
        ) : null}
      </View>
      {/* Nút có chữ, không chỉ mũi tên */}
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Button kind="secondary" label={`‹ ${vi.journal.prevDay}`} onPress={() => setDay(addDays(day, -1))} style={{ flex: 1 }} />
        {day < today ? (
          <Button kind="secondary" label={`${vi.journal.nextDay} ›`} onPress={() => setDay(addDays(day, 1))} style={{ flex: 1 }} />
        ) : null}
      </View>
    </View>
  );

  const t = totals.totals;
  const summary = (
    <View style={{ gap: space.md }}>
      <Card style={{ alignItems: 'center' }}>
        <Txt variant="bodyStrong" tone="secondary">
          {vi.journal.total}
        </Txt>
        <Amount value={formatVND(t.total)} size={font.size.amount} />
        <Txt tone="secondary">{vi.journal.orders(t.count)}</Txt>
        {t.queuedCount > 0 ? (
          <Txt variant="small" tone="warn" center>
            {vi.journal.queuedNote(t.queuedCount)}
          </Txt>
        ) : null}
      </Card>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <MethodCard label={vi.journal.transfer} amount={t.byMethod.VIETQR.amount} count={t.byMethod.VIETQR.count} />
        <MethodCard label={vi.journal.cash} amount={t.byMethod.CASH.amount} count={t.byMethod.CASH.count} />
      </View>
      {month.data ? (
        <Card>
          <Txt variant="small" tone="secondary">
            {vi.journal.monthTotal}
          </Txt>
          <Txt variant="title">{`${formatVND(month.data.total)} · ${vi.journal.orders(month.data.count)}`}</Txt>
        </Card>
      ) : null}
      {totals.error ? <ErrorView error={totals.error} onRetry={() => void totals.refetch()} /> : null}
    </View>
  );

  const list = (
    <FlatList
      data={rows}
      keyExtractor={(o) => o.id}
      renderItem={({ item }) => <OrderRow o={item} />}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.divider }} />}
      ListHeaderComponent={
        <View style={{ gap: space.md, paddingBottom: space.md }}>
          {L.kind !== 'split' ? (
            <>
              <BackLink label={vi.common.home} href="/trang-chinh" />
              <OfflineBanner queued={queuedCount} />
              {dayNav}
              {summary}
            </>
          ) : null}
          <Txt variant="title">{vi.journal.recent}</Txt>
        </View>
      }
      ListEmptyComponent={orders.isLoading ? <Loading /> : orders.error ? <ErrorView error={orders.error} onRetry={() => void orders.refetch()} /> : <Empty text={vi.journal.empty} />}
      ListFooterComponent={
        orders.hasNextPage ? (
          <Button kind="secondary" label={vi.journal.more} busy={orders.isFetchingNextPage} onPress={() => void orders.fetchNextPage()} style={{ marginTop: space.md }} />
        ) : null
      }
      contentContainerStyle={{ padding: space.gutter, paddingBottom: insets.bottom + space.xl }}
      // Danh sách dài: chỉ vẽ phần đang nhìn thấy
      initialNumToRender={12}
      windowSize={7}
      removeClippedSubviews
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      {L.kind === 'split' ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1, padding: space.gutter, gap: space.md }}>
            <BackLink label={vi.common.home} href="/trang-chinh" />
            <OfflineBanner queued={queuedCount} />
            {dayNav}
            {summary}
          </View>
          <View style={{ flex: 1.2 }}>{list}</View>
        </View>
      ) : (
        list
      )}
    </View>
  );
}

function MethodCard({ label, amount, count }: { label: string; amount: number; count: number }) {
  return (
    <Card style={{ flex: 1 }}>
      <Txt variant="small" tone="secondary">
        {label}
      </Txt>
      <Amount value={formatVND(amount)} size={font.size.amountSmall - 8} center={false} />
      <Txt variant="small" tone="secondary">
        {vi.journal.orders(count)}
      </Txt>
    </Card>
  );
}

function noteFor(o: Order): string | null {
  const v = paymentView(o);
  if (v.kind === 'PARTIAL') return vi.journal.notePartial(formatVND(v.missing));
  if (v.kind === 'OVERPAID') return vi.journal.noteOver(formatVND(v.over));
  if (v.kind === 'PAID' && v.manual) return vi.journal.noteManual;
  if (v.kind === 'WAITING') return vi.journal.noteUnpaid;
  if (v.kind === 'CANCELLED') return vi.journal.noteCancelled;
  if (o.clock_suspect) return vi.journal.clockWrong;
  return null;
}

function OrderRow({ o }: { o: Order }) {
  const note = noteFor(o);
  const method = o.payment_method === 'CASH' ? vi.journal.cash : o.payment_method === 'CARD' ? vi.journal.card : vi.journal.transfer;
  const dim = o.payment_status !== 'PAID';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.sm, gap: space.md }}>
      <Txt variant="bodyStrong" tone="secondary" style={{ width: 64 }}>
        {formatTimeVN(o.sold_at)}
      </Txt>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong" tone={dim ? 'secondary' : 'ink'}>
          {formatVND(o.total_amount)}
        </Txt>
        {note ? (
          <Txt variant="small" tone={o.payment_status === 'PAID' ? 'warn' : 'secondary'}>
            {note}
          </Txt>
        ) : null}
      </View>
      <Txt variant="small" tone="secondary">
        {method}
      </Txt>
    </View>
  );
}
