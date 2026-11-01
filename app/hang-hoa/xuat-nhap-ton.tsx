import { useState } from 'react';
import { Share, View } from 'react-native';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ChoiceGrid } from '../../src/components/Choice';
import { Empty, ErrorView, Loading } from '../../src/components/States';
import { useBusinessId, useSession } from '../../src/features/session/store';
import { useStockReport, formatQty } from '../../src/features/shop/hooks';
import { dayToVN, stockPeriodRange, stockReportCsv, stockTotals, type StockPeriod } from '../../src/features/shop/inventory';
import { formatVND } from '../../src/lib/money';
import { vnDay } from '../../src/lib/time';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

const PERIODS: StockPeriod[] = ['TODAY', 'D7', 'MONTH', 'LAST_MONTH'];
const signed = (n: number) => (n > 0 ? `+${formatQty(n)}` : formatQty(n));

/** 6.5 Xuất – nhập – tồn: mỗi món có tồn đầu kỳ, nhập, bán, xuất hủy, kiểm kho, tồn cuối; giá trị tồn; gửi bảng CSV. */
export default function XuatNhapTon() {
  const businessId = useBusinessId();
  const shop = useSession((s) => s.business?.business_name ?? '');
  const [period, setPeriod] = useState<StockPeriod>('MONTH');
  const range = stockPeriodRange(period, vnDay());
  const report = useStockReport(businessId, range.from, range.to);
  const rows = report.data ?? [];
  const totals = stockTotals(rows);

  const share = () => {
    const title = `${vi.catalog.reportTitle} · ${vi.catalog.reportRange(dayToVN(range.fromDay), dayToVN(range.toDay))}`;
    void Share.share({ title, message: `${shop}\n${stockReportCsv(rows, range.fromDay, range.toDay)}` });
  };

  return (
    <Screen back={{ label: vi.catalog.title, href: '/hang-hoa' }} maxWidth={800}>
      <Txt variant="heading">{vi.catalog.reportTitle}</Txt>
      <ChoiceGrid
        options={PERIODS.map((k) => ({ key: k, label: vi.catalog.reportPeriods[k] ?? k }))}
        value={period}
        onChange={setPeriod}
        columns={2}
        testIdPrefix="stock-period"
      />
      <Txt tone="secondary">{vi.catalog.reportRange(dayToVN(range.fromDay), dayToVN(range.toDay))}</Txt>

      {report.isLoading ? <Loading /> : null}
      {report.error ? <ErrorView error={report.error} onRetry={() => void report.refetch()} /> : null}
      {report.data && rows.length === 0 ? <Empty text={vi.catalog.reportEmpty} /> : null}

      {rows.length > 0 ? (
        <>
          <Card style={{ alignItems: 'center' }}>
            <Txt variant="bodyStrong" tone="secondary" center>
              {vi.catalog.closingValue}
            </Txt>
            <Amount value={formatVND(totals.closingValue)} size={font.size.amountSmall} />
            {totals.missingCost > 0 ? (
              <Txt variant="small" tone="warn" center>
                {vi.catalog.missingCost(totals.missingCost)}
              </Txt>
            ) : null}
          </Card>
          {rows.map((r) => (
            <Card key={r.product_id} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Txt variant="bodyStrong" style={{ flex: 1 }}>
                  {r.name}
                </Txt>
                <Txt variant="bodyStrong" tone={r.closing <= 0 ? 'danger' : 'primary'}>
                  {vi.catalog.rowClosing(formatQty(r.closing), r.unit)}
                </Txt>
              </View>
              <Txt variant="small" tone="secondary">
                {vi.catalog.rowLine(formatQty(r.opening), signed(r.qty_in), formatQty(r.qty_sold), formatQty(r.qty_out))}
              </Txt>
              {r.qty_adjust !== 0 ? (
                <Txt variant="small" tone="warn">
                  {vi.catalog.rowAdjust(signed(r.qty_adjust))}
                </Txt>
              ) : null}
              {r.closing_value !== null ? (
                <Txt variant="small" tone="secondary">
                  {formatVND(r.closing_value)}
                </Txt>
              ) : null}
            </Card>
          ))}
          <Button kind="secondary" label={vi.catalog.shareCsv} onPress={share} />
        </>
      ) : null}
    </Screen>
  );
}
