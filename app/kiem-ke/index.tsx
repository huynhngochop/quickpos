import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Empty, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useStockCounts } from '../../src/features/shop/hooks';
import { startStockCount } from '../../src/features/shop/api';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { formatDateVN, formatTimeVN } from '../../src/lib/time';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

/** 6.9 Kiểm kê: lần đang kiểm (làm tiếp) và các lần đã chốt. */
export default function KiemKe() {
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const qc = useQueryClient();
  const counts = useStockCounts(businessId);
  const open = (counts.data ?? []).find((c) => c.status === 'OPEN');
  const start = useMutation({
    mutationFn: () => startStockCount(newId(), businessId),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['products', businessId, 'counts'] });
      router.push({ pathname: '/kiem-ke/[id]', params: { id: c.id } });
    },
  });
  const statusLabel = (s: string) => (s === 'OPEN' ? vi.inv.countOpen : s === 'DONE' ? vi.inv.countDone : vi.inv.countCancelled);

  return (
    <Screen back={{ label: vi.catalog.title, href: '/hang-hoa' }} maxWidth={720}>
      <Txt variant="heading">{vi.inv.countsTitle}</Txt>
      <Txt tone="secondary">{vi.inv.countsHelp}</Txt>
      {manage ? (
        open ? (
          <Button big label={vi.inv.continueCount} onPress={() => router.push({ pathname: '/kiem-ke/[id]', params: { id: open.id } })} testID="continue-count" />
        ) : (
          <Button big label={vi.inv.startCount} onPress={() => start.mutate()} busy={start.isPending} testID="start-count" />
        )
      ) : (
        <Txt tone="secondary">{vi.errors.QP_FORBIDDEN}</Txt>
      )}
      {start.error ? <ErrorView error={start.error} /> : null}
      {counts.isLoading ? <Loading /> : null}
      {counts.error ? <ErrorView error={counts.error} onRetry={() => void counts.refetch()} /> : null}
      {counts.data && counts.data.length === 0 ? <Empty text={vi.inv.countEmpty} /> : null}
      {(counts.data ?? []).map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          accessibilityLabel={`${statusLabel(c.status)}, ${formatDateVN(c.started_at)}`}
          onPress={() => router.push({ pathname: '/kiem-ke/[id]', params: { id: c.id } })}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{vi.inv.countStarted(`${formatDateVN(c.started_at)} ${formatTimeVN(c.started_at)}`)}</Txt>
              <Txt variant="small" tone={c.status === 'OPEN' ? 'warn' : 'secondary'}>
                {statusLabel(c.status)}
              </Txt>
              {c.status === 'DONE' ? (
                <Txt variant="small" tone="secondary">
                  {`${vi.inv.countSummary(c.lines_total, c.lines_diff)} · ${vi.inv.countValue(formatVND(c.value_diff))}`}
                </Txt>
              ) : null}
            </View>
            <Txt variant="heading" tone="secondary">
              ›
            </Txt>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
