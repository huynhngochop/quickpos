import { Share, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid } from '../src/components/Choice';
import { ErrorView, Loading } from '../src/components/States';
import { canManage, useBusinessId, useSession } from '../src/features/session/store';
import { usePeriodReport } from '../src/features/books/hooks';
import { updateTaxIndustry } from '../src/features/books/api';
import { estimateTax, INDUSTRY_RATES, nextDeadline, TAX_FREE_THRESHOLD, type TaxIndustry } from '../src/features/tax/taxEstimate';
import { revenueCsv } from '../src/features/reports/period';
import { formatVND } from '../src/lib/money';
import { vnDay } from '../src/lib/time';
import { colors, font, radius, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

const INDUSTRIES: TaxIndustry[] = ['GOODS', 'PRODUCTION', 'SERVICE', 'LEASING', 'OTHER'];
const pctText = (perMille: number) => `${String(perMille / 10).replace('.', ',')}%`;
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** 5.1 Thuế của quán (sau mã PIN chủ quán): ngưỡng 1 tỷ, ước tính thuế, hạn nộp, gửi sổ doanh thu. Số liệu tham khảo. */
export default function Thue() {
  const businessId = useBusinessId();
  const business = useSession((s) => s.business);
  const role = useSession((s) => s.role);
  const industry: TaxIndustry = business?.tax_industry ?? 'GOODS';
  const today = vnDay();
  const { sales, expenses, data } = usePeriodReport(businessId, 'year', today);
  const setIndustry = useMutation({
    mutationFn: (k: TaxIndustry) => updateTaxIndustry(businessId, k),
    onSuccess: (b) => useSession.getState().set({ business: b }),
  });

  const est = data ? estimateTax({ revenue: data.now.revenue, expenses: data.expenseTotal, industry, today }) : null;
  const deadline = est ? nextDeadline(today, est.overThreshold) : null;
  const used = est ? Math.min(Math.round((est.revenue / TAX_FREE_THRESHOLD) * 100), 999) : 0;
  const rates = INDUSTRY_RATES[industry];

  const share = async () => {
    if (!data) return;
    const title = vi.reports.exportTitle(dmy(data.period.from), dmy(data.period.to));
    await Share.share({ title, message: `${business?.business_name ?? ''} · Mã số thuế ${business?.tax_code ?? ''}\n${title}\n\n${revenueCsv(data.now, data.expensesByDay)}` });
  };

  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={720}>
      <Txt variant="heading">{vi.tax.title}</Txt>
      <Card tone="info">
        <Txt tone="primary">{vi.tax.disclaimer}</Txt>
      </Card>
      {sales.isLoading || expenses.isLoading ? <Loading /> : null}
      {sales.error ? <ErrorView error={sales.error} onRetry={() => void sales.refetch()} /> : null}

      {est && deadline ? (
        <>
          <Card style={{ gap: space.sm }}>
            <Txt variant="bodyStrong" tone="secondary">
              {vi.tax.yearRevenue(today.slice(0, 4))}
            </Txt>
            <Amount value={formatVND(est.revenue)} size={font.size.amountSmall} center={false} />
            <Txt tone="secondary">{vi.tax.threshold}</Txt>
            {/* Thanh tiến độ tới ngưỡng 1 tỷ: có chữ % kèm theo, không chỉ dựa vào màu */}
            <View style={{ height: 16, borderRadius: radius.pill, backgroundColor: colors.divider, overflow: 'hidden' }}>
              <View
                style={{
                  width: `${Math.min(used, 100)}%`,
                  height: '100%',
                  backgroundColor: est.overThreshold ? colors.warn : est.projectedOverThreshold ? colors.warn : colors.success,
                }}
              />
            </View>
            <Txt variant="bodyStrong">{vi.tax.progress(used)}</Txt>
            <Txt tone="secondary">{vi.tax.projected(formatVND(est.projectedRevenue))}</Txt>
          </Card>

          {!est.overThreshold ? (
            <Card tone={est.projectedOverThreshold ? 'warn' : 'success'} style={{ gap: space.xs }}>
              <Txt variant="title" tone={est.projectedOverThreshold ? 'warn' : 'success'}>
                {vi.tax.underTitle}
              </Txt>
              <Txt>{vi.tax.underBody}</Txt>
              {est.projectedOverThreshold ? (
                <Txt variant="bodyStrong" tone="warn">
                  {vi.tax.willExceed}
                </Txt>
              ) : null}
            </Card>
          ) : (
            <Card tone="warn" style={{ gap: space.sm }}>
              <Txt variant="title" tone="warn">
                {vi.tax.overTitle}
              </Txt>
              <Line label={vi.tax.vat(pctText(rates.vat))} value={formatVND(est.vat)} />
              {est.pitByRate !== null ? (
                <>
                  <Line label={vi.tax.pitRate(pctText(rates.pit))} value={formatVND(est.pitByRate)} />
                  <Txt variant="small" tone="secondary">
                    {vi.tax.pitIncomeAlt(formatVND(est.pitByIncome))}
                  </Txt>
                </>
              ) : (
                <Line label={vi.tax.pitIncome(est.revenue > 50_000_000_000 ? '20%' : '17%')} value={formatVND(est.pitByIncome)} />
              )}
              <Line label={vi.tax.totalEst} value={formatVND(est.total)} strong />
            </Card>
          )}

          <Card style={{ gap: space.xs }}>
            <Txt variant="title">{vi.tax.deadline}</Txt>
            <Txt variant="bodyStrong">
              {deadline.label === 'YEAR_NOTICE' ? vi.tax.yearNotice(deadline.period, dmy(deadline.date)) : vi.tax.quarterReturn(deadline.period, dmy(deadline.date))}
            </Txt>
            <Txt tone="secondary">{vi.tax.howTo}</Txt>
            <Txt tone="secondary">{vi.tax.expenses(formatVND(data?.expenseTotal ?? 0))}</Txt>
          </Card>
          <Button kind="secondary" label={vi.tax.export} onPress={() => void share()} />

          <Txt variant="title">{vi.tax.industry}</Txt>
          {setIndustry.error ? <ErrorView error={setIndustry.error} /> : null}
          <ChoiceGrid
            options={INDUSTRIES.map((k) => ({ key: k, label: vi.tax.industries[k] }))}
            value={industry}
            onChange={(k) => {
              if (canManage(role)) setIndustry.mutate(k);
            }}
            columns={1}
            testIdPrefix="industry"
          />
        </>
      ) : null}
    </Screen>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
      <Txt style={{ flex: 1 }} variant={strong ? 'bodyStrong' : 'body'}>
        {label}
      </Txt>
      <Txt variant="bodyStrong">{value}</Txt>
    </View>
  );
}
