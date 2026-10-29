/**
 * Ngày nghiệp vụ theo giờ Việt Nam (UTC+7, không có giờ mùa hè).
 * Không dựa vào múi giờ của máy: máy của quán có thể đặt sai múi giờ.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Đổi thời điểm sang "đồng hồ treo tường" ở VN (đọc bằng getUTC*). */
function vnWall(d: Date): Date {
  return new Date(d.getTime() + VN_OFFSET_MS);
}

/** Ngày bán theo giờ VN: "2026-10-29" */
export function vnDay(d: Date = new Date()): string {
  const w = vnWall(d);
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
}

/** Khoảng [from, to) của một ngày VN, dạng ISO để gửi cho list_orders. */
export function vnDayRange(day: string): { from: string; to: string } {
  const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(y, m - 1, dd) - VN_OFFSET_MS;
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000).toISOString() };
}

/** Cộng/trừ ngày: addDays("2026-10-29", -1) → "2026-10-28" */
export function addDays(day: string, n: number): string {
  const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Ngày đầu tháng của một ngày VN: "2026-10-01" */
export function monthStart(day: string): string {
  return `${day.slice(0, 8)}01`;
}

/** "Thứ Năm, 29/10/2026" */
export function formatDayLong(day: string): string {
  const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${pad(dd)}/${pad(m)}/${y}`;
}

/** "14:05" theo giờ VN */
export function formatTimeVN(iso: string | Date): string {
  const w = vnWall(typeof iso === 'string' ? new Date(iso) : iso);
  return `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
}

/** "29/10/2026" theo giờ VN */
export function formatDateVN(iso: string | Date): string {
  const w = vnWall(typeof iso === 'string' ? new Date(iso) : iso);
  return `${pad(w.getUTCDate())}/${pad(w.getUTCMonth() + 1)}/${w.getUTCFullYear()}`;
}

/** Đồng hồ chờ: 25 → "0:25", 100 → "1:40" */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
