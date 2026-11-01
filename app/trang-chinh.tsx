import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { DemoBanner, OfflineBanner, callSupport } from '../src/components/States';
import { ConfirmSheet } from '../src/components/ConfirmSheet';
import { logoutHere } from '../src/features/session/logout';
import { useDebtors, useExpenses } from '../src/features/books/hooks';
import { useSession, useBusinessId } from '../src/features/session/store';
import { openOwnerScreen, useCanReview, useMainAccount } from '../src/features/session/hooks';
import { useDayTotals } from '../src/features/journal/hooks';
import { useReview } from '../src/features/review/hooks';
import { useQueue } from '../src/features/offline/useQueue';
import { formatVND } from '../src/lib/money';
import { formatDayLong, monthStart, vnDay } from '../src/lib/time';
import { colors, font, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/**
 * 2.1 Trang chính: một nút lớn "Thu tiền" ở đáy + các ô việc có chữ (sổ, báo cáo, sổ nợ, chi tiêu, thuế, hỗ trợ).
 * Báo cáo, Thuế, Cài đặt nằm sau mã PIN chủ quán. "Thoát" hỏi lại trước khi đăng xuất.
 */
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
  const debtors = useDebtors(businessId);
  const expenses = useExpenses(businessId, monthStart(today), today);
  const owed = (debtors.data ?? []).reduce((s, d) => s + Math.max(d.balance, 0), 0);
  const spent = (expenses.data ?? []).reduce((s, e) => s + e.amount, 0);
  const [askExit, setAskExit] = useState(false);
  const [exitMsg, setExitMsg] = useState<string | null>(null);
  const exit = async () => {
    const blocked = await logoutHere(queue.length);
    setAskExit(false);
    if (blocked > 0) setExitMsg(vi.settings.logoutBlocked(blocked));
  };

  return (
    <Screen
      maxWidth={640}
      footer={
        <Button big label={vi.main.collect} onPress={() => router.push('/thu-tien')} style={{ minHeight: 88 }} />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">{name}</Txt>
          <Txt tone="secondary">{formatDayLong(today)}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Button kind="link" label={vi.main.settings} onPress={() => openOwnerScreen('/cai-dat')} />
          <Button kind="link" label={vi.main.exit} onPress={() => setAskExit(true)} />
        </View>
      </View>
      {exitMsg ? (
        <Card tone="warn">
          <Txt tone="warn" variant="bodyStrong">
            {exitMsg}
          </Txt>
        </Card>
      ) : null}

      <OfflineBanner queued={queue.length} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${vi.main.todayCollected} ${formatVND(totals.total)}, ${vi.main.ordersTap(totals.count)}`}
        onPress={() => router.push('/so')}
      >
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
        <Pressable accessibilityRole="button" accessibilityLabel={vi.main.needReview(review.count)} onPress={() => openOwnerScreen('/xem-lai')}>
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

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        <Tile label={vi.main.journal} onPress={() => router.push('/so')} />
        <Tile label={vi.main.reports} onPress={() => openOwnerScreen('/bao-cao')} />
        <Tile label={vi.main.debts} sub={owed > 0 ? vi.debts.owes(formatVND(owed)) : undefined} onPress={() => router.push('/so-no')} />
        <Tile label={vi.main.expenses} sub={spent > 0 ? `${vi.expenses.thisMonth}: ${formatVND(spent)}` : undefined} onPress={() => router.push('/chi-tieu')} />
        <Tile label={vi.main.tax} onPress={() => openOwnerScreen('/thue')} />
        <Tile label={vi.main.support} onPress={callSupport} />
      </View>

      {account.isSuccess && !account.data ? (
        <Card tone="info">
          <Txt tone="primary" variant="bodyStrong">
            {vi.main.noAccount}
          </Txt>
        </Card>
      ) : null}

      {/* Bản dùng thử: để cuối trang để các ô việc nằm gọn trong màn hình đầu tiên */}
      <DemoBanner />
      <ConfirmSheet
        visible={askExit}
        title={vi.main.exitAsk}
        body={vi.main.exitBody}
        yes={vi.main.exitYes}
        no={vi.main.exitNo}
        onYes={() => void exit()}
        onNo={() => setAskExit(false)}
      />
    </Screen>
  );
}

/** Ô việc trên trang chính: chữ to, cả ô bấm được, cao ≥ 72dp; hai ô một hàng. */
function Tile({ label, sub, onPress }: { label: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: '46%',
        flexGrow: 1,
        minHeight: 76,
        borderRadius: radius.lg,
        borderWidth: 2,
        borderColor: colors.ink,
        backgroundColor: pressed ? colors.divider : colors.surface,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        justifyContent: 'center',
        alignItems: 'center',
      })}
    >
      <Txt variant="button" center>
        {label}
      </Txt>
      {sub ? (
        <Txt variant="small" tone="secondary" center numberOfLines={2}>
          {sub}
        </Txt>
      ) : null}
    </Pressable>
  );
}
