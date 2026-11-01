import { useState } from 'react';
import { Share, View } from 'react-native';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { BarChart, ChoiceGrid } from '../src/components/Choice';
import { Empty, ErrorView, Loading } from '../src/components/States';
import { useBusinessId, useSession } from '../src/features/session/store';
import { usePeriodReport } from '../src/features/books/hooks';
import { bucketSeries, changePct, revenueCsv, type PeriodKey } from '../src/features/reports/period';
import { formatVND } from '../src/lib/money';
import { vnDay } from '../src/lib/time';
import { font, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

const PERIODS: PeriodKey[] = ['today', '7d', 'month', 'lastMonth', '30d', 'year'];
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** 3.4 Báo cáo bán hàng theo kỳ (sau mã PIN chủ quán). Đọc tổng theo ngày có sẵn ở server, không cộng từng đơn. */
export default function BaoCao() {
  const businessId = useBusinessId();
  const shop = useSession((s) => s.business?.business_name ?? '');
  const today = vnDay();
  const [key, setKey] = useState<PeriodKey>('7d');
  const { sales, expenses, data } = usePeriodReport(businessId, key, today);

  const share = async () => {
    if (!data) return;
    const title = vi.reports.exportTitle(dmy(data.period.from) + '/' + data.period.from.slice(0, 4), dmy(data.period.to) + '/' + data.period.to.slice(0, 4));
    await Share.share({ title, message: `${shop}\n${title}\n\n${revenueCsv(data.now, data.expensesByDay)}` });
  };

  const pct = data ? changePct(data.now.revenue, data.prev.revenue) : null;
  const bars = data ? bucketSeries(data.now.series) : [];

  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={720}>
      <Txt variant="heading">{vi.reports.title}</Txt>
      <ChoiceGrid
        options={PERIODS.map((k) => ({ key: k, label: vi.reports.periods[k] }))}
        value={key}
        onChange={setKey}
        columns={3}
        testIdPrefix="period"
      />
      {sales.isLoading ? <Loading /> : null}
      {sales.error ? <ErrorView error={sales.error} onRetry={() => void sales.refetch()} /> : null}
      {data ? (
        <>
          <Card style={{ alignItems: 'center', gap: space.xs }}>
            <Txt variant="bodyStrong" tone="secondary">
              {vi.reports.revenue}
            </Txt>
            <Amount value={formatVND(data.now.revenue)} size={font.size.amount} />
            <Txt tone={pct === null ? 'secondary' : pct >= 0 ? 'success' : 'warn'} variant="bodyStrong" center>
              {pct === null ? vi.reports.noPrev : vi.reports.vsPrev(pct)}
            </Txt>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            <Stat label={vi.reports.orders} value={vi.journal.orders(data.now.orders)} />
            <Stat label={vi.reports.perOrder} value={formatVND(data.now.avgPerOrder)} />
            <Stat label={vi.reports.expenses} value={expenses.data ? formatVND(data.expenseTotal) : '…'} />
            <Stat label={vi.reports.profit} value={expenses.data ? formatVND(data.profit) : '…'} tone={data.profit < 0 ? 'warn' : 'success'} />
          </View>
          <Txt variant="small" tone="secondary">
            {vi.reports.profitNote}
          </Txt>

          {data.now.orders === 0 ? (
            <Empty text={vi.reports.empty} />
          ) : (
            <>
              {data.now.series.length > 1 ? (
                <Card style={{ gap: space.sm }}>
                  <Txt variant="title">{data.now.series.length > 62 ? vi.reports.chartMonth : vi.reports.chart}</Txt>
                  <BarChart bars={bars} format={formatVND} />
                  {data.now.bestDay ? (
                    <Txt tone="secondary">{vi.reports.bestDay(dmy(data.now.bestDay.day), formatVND(data.now.bestDay.amount))}</Txt>
                  ) : null}
                </Card>
              ) : null}

              <Card style={{ gap: space.sm }}>
                <Txt variant="title">{vi.reports.byMethod}</Txt>
                <MethodRow label={vi.journal.transfer} amount={data.now.byMethod.VIETQR.amount} orders={data.now.byMethod.VIETQR.orders} total={data.now.revenue} />
                <MethodRow label={vi.journal.cash} amount={data.now.byMethod.CASH.amount} orders={data.now.byMethod.CASH.orders} total={data.now.revenue} />
              </Card>
            </>
          )}

          <Button kind="secondary" label={vi.reports.export} onPress={() => void share()} />
        </>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'success' | 'warn' }) {
  return (
    <Card style={{ flexBasis: '46%', flexGrow: 1, gap: 2 }}>
      <Txt variant="small" tone="secondary">
        {label}
      </Txt>
      <Txt variant="title" tone={tone} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
    </Card>
  );
}

function MethodRow({ label, amount, orders, total }: { label: string; amount: number; orders: number; total: number }) {
  const share = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        <Txt variant="small" tone="secondary">
          {`${vi.journal.orders(orders)} · ${share}%`}
        </Txt>
      </View>
      <Txt variant="bodyStrong">{formatVND(amount)}</Txt>
    </View>
  );
}
