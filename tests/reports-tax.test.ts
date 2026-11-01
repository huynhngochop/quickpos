import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTax, nextDeadline, dayOfYear, TAX_FREE_THRESHOLD } from '../src/features/tax/taxEstimate';
import { bucketSeries, changePct, periodFor, revenueCsv, totalsFor } from '../src/features/reports/period';
import type { DailySalesRow } from '../src/types/api';

test('thuế: dưới 1 tỷ không phải nộp, chỉ thông báo doanh thu', () => {
  const t = estimateTax({ revenue: 800_000_000, expenses: 0, industry: 'GOODS', today: '2026-12-31' });
  assert.equal(t.total, 0);
  assert.equal(t.form, '01/TKN-CNKD');
  assert.equal(t.overThreshold, false);
});

test('thuế: tạp hóa 2 tỷ → GTGT 1% toàn bộ, TNCN 0,5% phần vượt 1 tỷ', () => {
  const t = estimateTax({ revenue: 2_000_000_000, expenses: 1_700_000_000, industry: 'GOODS', today: '2026-12-31' });
  assert.equal(t.vat, 20_000_000);
  assert.equal(t.pitByRate, 5_000_000);
  assert.equal(t.pitByIncome, 45_000_000, 'cách thu nhập: (2 tỷ − 1,7 tỷ) × 15%');
  assert.equal(t.total, 25_000_000);
  assert.equal(t.method, 'RATE');
  assert.equal(t.form, '01/CNKD');
});

test('thuế: quán ăn 1,2 tỷ → GTGT 3%, TNCN 1,5% × 200 triệu', () => {
  const t = estimateTax({ revenue: 1_200_000_000, expenses: 0, industry: 'PRODUCTION', today: '2026-12-31' });
  assert.equal(t.vat, 36_000_000);
  assert.equal(t.pitByRate, 3_000_000);
});

test('thuế: trên 3 tỷ tính TNCN theo thu nhập 17%', () => {
  const t = estimateTax({ revenue: 10_000_000_000, expenses: 8_000_000_000, industry: 'GOODS', today: '2026-12-31' });
  assert.equal(t.method, 'INCOME');
  assert.equal(t.pitByRate, null);
  assert.equal(t.pitByIncome, 340_000_000);
  assert.equal(t.total, 100_000_000 + 340_000_000);
});

test('thuế: dự báo cả năm từ số đã bán', () => {
  // 1/7 (ngày thứ 182 của 2026) đã bán 600 triệu → cả năm ≈ 1,2 tỷ → sắp vượt ngưỡng
  const t = estimateTax({ revenue: 600_000_000, expenses: 0, industry: 'GOODS', today: '2026-07-01' });
  assert.equal(dayOfYear('2026-07-01').n, 182);
  assert.ok(t.projectedRevenue > TAX_FREE_THRESHOLD);
  assert.equal(t.projectedOverThreshold, true);
  assert.equal(t.total, 0, 'chưa vượt thì chưa tính thuế');
});

test('hạn nộp: dưới ngưỡng 31/01 năm sau; trên ngưỡng theo quý', () => {
  assert.deepEqual(nextDeadline('2026-11-01', false), { date: '2027-01-31', label: 'YEAR_NOTICE', period: '2026' });
  assert.deepEqual(nextDeadline('2027-01-10', false), { date: '2027-01-31', label: 'YEAR_NOTICE', period: '2026' });
  assert.deepEqual(nextDeadline('2026-11-01', true), { date: '2027-01-31', label: 'QUARTER_RETURN', period: 'Q4/2026' });
  assert.deepEqual(nextDeadline('2026-10-05', true), { date: '2026-10-31', label: 'QUARTER_RETURN', period: 'Q3/2026' });
  assert.deepEqual(nextDeadline('2027-01-05', true), { date: '2027-01-31', label: 'QUARTER_RETURN', period: 'Q4/2026' });
  assert.deepEqual(nextDeadline('2026-02-15', true), { date: '2026-04-30', label: 'QUARTER_RETURN', period: 'Q1/2026' });
});

test('kỳ báo cáo và kỳ so sánh', () => {
  assert.deepEqual(periodFor('7d', '2026-11-01'), { key: '7d', from: '2026-10-26', to: '2026-11-01', prevFrom: '2026-10-19', prevTo: '2026-10-25' });
  assert.deepEqual(periodFor('lastMonth', '2026-11-01'), { key: 'lastMonth', from: '2026-10-01', to: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30' });
  const m = periodFor('month', '2026-03-31');
  assert.equal(m.prevFrom, '2026-02-01');
  assert.equal(m.prevTo, '2026-02-28', 'tháng trước ngắn hơn: dừng ở cuối tháng');
  assert.deepEqual(periodFor('year', '2026-11-01').prevTo, '2025-11-01');
});

test('tổng kỳ: theo phương thức, đủ ngày, ngày bán nhiều nhất, CSV', () => {
  const rows: DailySalesRow[] = [
    { business_id: 'b', sale_date: '2026-10-30', method: 'VIETQR', orders_count: 3, amount: 90_000 },
    { business_id: 'b', sale_date: '2026-10-30', method: 'CASH', orders_count: 1, amount: 10_000 },
    { business_id: 'b', sale_date: '2026-11-01', method: 'CASH', orders_count: 2, amount: 50_000 },
    { business_id: 'b', sale_date: '2026-09-01', method: 'CASH', orders_count: 9, amount: 999_000 },
  ];
  const t = totalsFor(rows, '2026-10-30', '2026-11-01');
  assert.equal(t.revenue, 150_000);
  assert.equal(t.orders, 6);
  assert.equal(t.byMethod.VIETQR.amount, 90_000);
  assert.deepEqual(t.series.map((s) => s.amount), [100_000, 0, 50_000]);
  assert.deepEqual(t.bestDay, { day: '2026-10-30', amount: 100_000 });
  assert.equal(t.avgPerOrder, 25_000);
  assert.equal(t.avgPerDay, 50_000);
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(150, 0), null);
  const csv = revenueCsv(t, new Map([['2026-10-31', 20_000]]));
  assert.equal(csv.split('\n')[0], 'Ngày,Doanh thu (đồng),Chi phí (đồng)');
  assert.equal(csv.split('\n')[2], '31/10/2026,0,20000');
  assert.equal(csv.split('\n').at(-1), 'Tổng,150000,20000');
});

test('biểu đồ: kỳ dài gộp theo tháng/tuần', () => {
  const year = totalsFor([], '2026-01-01', '2026-11-01');
  assert.equal(bucketSeries(year.series).length, 11, 'cả năm → 11 cột theo tháng');
  const d30 = totalsFor([], '2026-10-03', '2026-11-01');
  assert.ok(bucketSeries(d30.series).length <= 12);
  assert.equal(bucketSeries(totalsFor([], '2026-10-26', '2026-11-01').series)[0]!.label, '26/10');
});
