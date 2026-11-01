/**
 * Logic thuần cho quản lý hàng hóa (tìm kiếm, mã vạch, hạn dùng, xuất nhập tồn) — kiểm thử ở tests/inventory.test.ts.
 */
import type { ExpiringLot, Product, StockReportRow } from '../../types/api';
import { addDays, monthStart, vnDayRange } from '../../lib/time';

/** Bỏ dấu tiếng Việt, chữ thường: "Sữa Tươi" → "sua tuoi" (người lớn tuổi hay gõ không dấu). */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Tìm theo tên, nhóm hoặc mã vạch; mọi từ gõ vào đều phải có (không phân biệt dấu). */
export function matchProduct(p: Pick<Product, 'name' | 'category' | 'barcode'>, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  const code = (p.barcode ?? '').toLowerCase();
  if (code && code.includes(q.replace(/\s+/g, ''))) return true;
  const hay = fold(`${p.name} ${p.category ?? ''}`);
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Mã đọc từ camera/máy quét: bỏ khoảng trắng, xuống dòng. */
export function cleanCode(raw: string): string {
  return raw.replace(/\s+/g, '').slice(0, 64);
}

export function findByBarcode<T extends Pick<Product, 'barcode'>>(products: T[], raw: string): T | undefined {
  const code = cleanCode(raw);
  if (!code) return undefined;
  return products.find((p) => p.barcode === code) ?? products.find((p) => (p.barcode ?? '').toLowerCase() === code.toLowerCase());
}

/** Gõ ngày: tự thêm dấu "/" → "05/12/2026" */
export function maskDate(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "05/12/2026" → "2026-12-05"; ngày không có thật (31/02) → null */
export function parseDateVN(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [dd, mm, yy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (yy < 2000 || yy > 2100 || mm < 1 || mm > 12 || dd < 1) return null;
  const t = new Date(Date.UTC(yy, mm - 1, dd));
  if (t.getUTCMonth() !== mm - 1) return null;
  return `${yy}-${m[2]}-${m[1]}`;
}

/** "2026-12-05" → "05/12/2026" */
export function dayToVN(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/** Số ngày từ hôm nay (VN) tới ngày hết hạn; âm = đã quá hạn. */
export function daysUntil(today: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export type ExpiryTone = 'danger' | 'warn' | 'success';

export function expiryTone(days: number, warnDays: number): ExpiryTone {
  if (days < 0) return 'danger';
  if (days <= warnDays) return 'warn';
  return 'success';
}

/** Gom lô sắp/đã hết hạn theo món: id món → lô gần nhất (để hiện nhãn trong danh sách). */
export function nearestExpiryByProduct(lots: ExpiringLot[]): Map<string, ExpiringLot> {
  const m = new Map<string, ExpiringLot>();
  for (const l of lots) {
    const cur = m.get(l.product_id);
    if (!cur || l.days_left < cur.days_left) m.set(l.product_id, l);
  }
  return m;
}

export function isLowStock(p: Pick<Product, 'is_active' | 'track_stock' | 'stock_qty' | 'low_stock_at'>): boolean {
  return p.is_active && p.track_stock && p.stock_qty <= (p.low_stock_at ?? 0);
}

// ---------- Xuất nhập tồn ----------
export type StockPeriod = 'TODAY' | 'D7' | 'MONTH' | 'LAST_MONTH';

/** Khoảng [from, to) theo giờ VN cho rpc('stock_report'). */
export function stockPeriodRange(period: StockPeriod, today: string): { from: string; to: string; fromDay: string; toDay: string } {
  let fromDay = today;
  let toDay = today;
  if (period === 'D7') fromDay = addDays(today, -6);
  if (period === 'MONTH') fromDay = monthStart(today);
  if (period === 'LAST_MONTH') {
    toDay = addDays(monthStart(today), -1);
    fromDay = monthStart(toDay);
  }
  return { from: vnDayRange(fromDay).from, to: vnDayRange(toDay).to, fromDay, toDay };
}

export function stockTotals(rows: StockReportRow[]) {
  return {
    products: rows.length,
    closingValue: rows.reduce((s, r) => s + (r.closing_value ?? 0), 0),
    missingCost: rows.filter((r) => r.cost_price === null && r.closing > 0).length,
  };
}

const q3 = (n: number) => String(Math.round(n * 1000) / 1000);

/** CSV xuất nhập tồn (mở bằng Excel/Google Trang tính). */
export function stockReportCsv(rows: StockReportRow[], fromDay: string, toDay: string): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ['Món', 'Đơn vị', 'Tồn đầu', 'Nhập', 'Bán', 'Xuất hủy/dùng', 'Kiểm kho (+/-)', 'Tồn cuối', 'Giá nhập', 'Giá trị tồn'];
  const lines = rows.map((r) =>
    [esc(r.name), esc(r.unit), q3(r.opening), q3(r.qty_in), q3(r.qty_sold), q3(r.qty_out), q3(r.qty_adjust), q3(r.closing),
      r.cost_price ?? '', r.closing_value ?? ''].join(','),
  );
  return [`Xuất nhập tồn ${dayToVN(fromDay)} - ${dayToVN(toDay)}`, head.join(','), ...lines].join('\n');
}
