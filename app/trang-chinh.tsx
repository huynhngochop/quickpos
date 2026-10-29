import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { OfflineBanner, callSupport } from '../src/components/States';
import { useSession, useBusinessId } from '../src/features/session/store';
import { openOwnerScreen, useCanReview, useMainAccount } from '../src/features/session/hooks';
import { useDayTotals } from '../src/features/journal/hooks';
import { useReview } from '../src/features/review/hooks';
import { useQueue } from '../src/features/offline/useQueue';
import { formatVND } from '../src/lib/money';
import { formatDayLong, vnDay } from '../src/lib/time';
import { font, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 2.1 Trang chính: tối đa 3 nút lớn có chữ. Cài đặt nằm sau mã PIN. */
export default function TrangChinh() {
  const businessId = useBusinessId();
  const name = useSession((s) => s.business?.business_name ?? '');
  const today = vnDay();
  const { totals } = useDayTotals(businessId, today);
  const canReview = useCanReview();
  const review = useReview(businessId, canReview);
  const account = useMainAccount(businessId);
  const queue = useQueue((s) => s.items);
  const stuck = queue.filter((q) => q.status === 'STUCK').length;

  return (
    <Screen
      maxWidth={640}
      footer={
        <>
          <Button big label={vi.main.collect} onPress={() => router.push('/thu-tien')} style={{ minHeight: 88 }} />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Button kind="secondary" label={vi.main.journal} onPress={() => router.push('/so')} style={{ flex: 1, minHeight: 72 }} />
            <Button kind="secondary" label={vi.main.support} onPress={callSupport} style={{ flex: 1, minHeight: 72 }} />
          </View>
        </>
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">{name}</Txt>
          <Txt tone="secondary">{formatDayLong(today)}</Txt>
        </View>
        <Button kind="link" label={vi.main.settings} onPress={() => openOwnerScreen('/cai-dat')} />
      </View>

      <OfflineBanner queued={queue.length} />

      <Pressable accessibilityRole="button" accessibilityHint={vi.main.journal} onPress={() => router.push('/so')}>
        <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
          <Txt tone="secondary" variant="bodyStrong">
            {vi.main.todayCollected}
          </Txt>
          <Amount value={formatVND(totals.total)} size={font.size.amount} />
          <Txt tone="primary" variant="bodyStrong">
            {vi.main.ordersTap(totals.count)}
          </Txt>
          {totals.queuedCount > 0 ? (
            <Txt tone="warn" variant="small">
              {vi.main.pendingQueue(totals.queuedCount)}
            </Txt>
          ) : null}
        </Card>
      </Pressable>

      {stuck > 0 ? (
        <Card tone="danger">
          <Txt tone="danger" variant="bodyStrong">
            {vi.offline.stuck(stuck)}
          </Txt>
        </Card>
      ) : null}

      {canReview && review.count > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => openOwnerScreen('/xem-lai')}>
          <Card tone="warn" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt tone="warn" variant="bodyStrong" style={{ flex: 1 }}>
              {vi.main.needReview(review.count)}
            </Txt>
            <Txt variant="heading" tone="warn">
              ›
            </Txt>
          </Card>
        </Pressable>
      ) : null}

      {account.isSuccess && !account.data ? (
        <Card tone="info">
          <Txt tone="primary" variant="bodyStrong">
            {vi.main.noAccount}
          </Txt>
        </Card>
      ) : null}
    </Screen>
  );
}
