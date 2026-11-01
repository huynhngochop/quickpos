/**
 * Báo cáo theo kỳ: tính từ các dòng daily_sales (tổng theo ngày, đã có sẵn ở server) và khoản chi.
 * Hàm thuần — kiểm thử ở tests/reports-tax.test.ts.
 */
import { addDays, monthStart } from '../../lib/time';
import type { DailySalesRow, PaymentMethod } from '../../types/api';

export type PeriodKey = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'year';

export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
  /** Kỳ liền trước cùng độ dài (để so sánh) */
  prevFrom: string;
  prevTo: string;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export function periodFor(key: PeriodKey, today: string): Period {
  const year = today.slice(0, 4);
  let from: string;
  let to = today;
  let prevFrom: string;
  let prevTo: string;
  switch (key) {
    case 'today':
      from = today;
      prevFrom = prevTo = addDays(today, -1);
      break;
    case '7d':
    case '30d': {
      const n = key === '7d' ? 7 : 30;
      from = addDays(today, -(n - 1));
      prevTo = addDays(from, -1);
      prevFrom = addDays(prevTo, -(n - 1));
      break;
    }
    case 'month': {
      from = monthStart(today);
      // So với cùng số ngày đầu tháng trước
      const lastMonthStart = monthStart(addDays(from, -1));
      prevFrom = lastMonthStart;
      const sameDay = addDays(lastMonthStart, daysBetween(from, today) - 1);
      const lastMonthEnd = addDays(from, -1);
      prevTo = sameDay < lastMonthEnd ? sameDay : lastMonthEnd;
      break;
    }
    case 'lastMonth': {
      to = addDays(monthStart(today), -1);
      from = monthStart(to);
      prevTo = addDays(from, -1);
      prevFrom = monthStart(prevTo);
      break;
    }
    case 'year': {
      from = `${year}-01-01`;
      const prevYear = String(Number(year) - 1);
      prevFrom = `${prevYear}-01-01`;
      prevTo = `${prevYear}${today.slice(4)}`;
      break;
    }
  }
  return { key, from, to, prevFrom, prevTo };
}

export interface PeriodTotals {
  revenue: number;
  orders: number;
  byMethod: Record<PaymentMethod, { amount: number; orders: number }>;
  /** Doanh thu từng ngày, đủ mọi ngày trong kỳ (ngày không bán = 0) */
  series: { day: string; amount: number }[];
  bestDay: { day: string; amount: number } | null;
  avgPerOrder: number;
  avgPerDay: number;
}

export function totalsFor(rows: DailySalesRow[], from: string, to: string): PeriodTotals {
  const byMethod: PeriodTotals['byMethod'] = { VIETQR: { amount: 0, orders: 0 }, CASH: { amount: 0, orders: 0 }, CARD: { amount: 0, orders: 0 } };
  const perDay = new Map<string, number>();
  let revenue = 0;
  let orders = 0;
  for (const r of rows) {
    if (r.sale_date < from || r.sale_date > to) continue;
    revenue += r.amount;
    orders += r.orders_count;
    byMethod[r.method].amount += r.amount;
    byMethod[r.method].orders += r.orders_count;
    perDay.set(r.sale_date, (perDay.get(r.sale_date) ?? 0) + r.amount);
  }
  const series: PeriodTotals['series'] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) series.push({ day: d, amount: perDay.get(d) ?? 0 });
  const bestDay = series.reduce<PeriodTotals['bestDay']>((b, x) => (x.amount > 0 && (!b || x.amount > b.amount) ? x : b), null);
  return {
    revenue,
    orders,
    byMethod,
    series,
    bestDay,
    avgPerOrder: orders > 0 ? Math.round(revenue / orders) : 0,
    avgPerDay: series.length > 0 ? Math.round(revenue / series.length) : 0,
  };
}

/** Phần trăm thay đổi so với kỳ trước, làm tròn; null khi kỳ trước bằng 0. */
export function changePct(now: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((now - prev) / prev) * 100);
}

/** Gộp chuỗi ngày thành tối đa `maxBars` cột (kỳ dài: theo tuần hoặc tháng) để biểu đồ đọc được trên điện thoại. */
export function bucketSeries(series: PeriodTotals['series'], maxBars = 12): { label: string; amount: number }[] {
  if (series.length <= maxBars) return series.map((s) => ({ label: s.day.slice(8, 10) + '/' + s.day.slice(5, 7), amount: s.amount }));
  if (series.length > 62) {
    const byMonth = new Map<string, number>();
    for (const s of series) byMonth.set(s.day.slice(0, 7), (byMonth.get(s.day.slice(0, 7)) ?? 0) + s.amount);
    return [...byMonth.entries()].map(([k, amount]) => ({ label: `T${Number(k.slice(5, 7))}`, amount }));
  }
  const size = Math.ceil(series.length / maxBars);
  const out: { label: string; amount: number }[] = [];
  for (let i = 0; i < series.length; i += size) {
    const chunk = series.slice(i, i + size);
    out.push({ label: chunk[0]!.day.slice(8, 10) + '/' + chunk[0]!.day.slice(5, 7), amount: chunk.reduce((s, x) => s + x.amount, 0) });
  }
  return out;
}

/** Sổ doanh thu theo ngày dạng CSV (mở được bằng Excel), dùng khi kê khai thuế. */
export function revenueCsv(t: PeriodTotals, expensesByDay: Map<string, number>): string {
  const lines = ['Ngày,Doanh thu (đồng),Chi phí (đồng)'];
  for (const s of t.series) {
    const [y, m, d] = s.day.split('-');
    lines.push(`${d}/${m}/${y},${s.amount},${expensesByDay.get(s.day) ?? 0}`);
  }
  let exp = 0;
  for (const v of expensesByDay.values()) exp += v;
  lines.push(`Tổng,${t.revenue},${exp}`);
  return lines.join('\n');
}
