/**
 * Bộ máy dữ liệu TRÊN MÁY: thay Supabase khi bản build chưa có địa chỉ máy chủ.
 * Chỉ cài đặt đúng những lời gọi app đang dùng (docs/api.md). supabase.ts chỉ chọn client này khi thiếu
 * EXPO_PUBLIC_SUPABASE_URL / ANON_KEY.
 *
 * Hai kiểu chạy:
 *  - Dữ liệu mẫu (EXPO_PUBLIC_DEMO_SAMPLE khác "0", dùng cho QA/xem thử): quán mới có sẵn đơn, hàng, sổ nợ mẫu,
 *    tài khoản ngân hàng giả, và giả lập "khách chuyển khoản" sau khi hiện mã QR.
 *  - Lưu trên máy (EXPO_PUBLIC_DEMO_SAMPLE=0, bản phát hành chưa có máy chủ): quán trống, chủ quán tự nhập
 *    tài khoản nhận tiền, tiền chuyển khoản xác nhận bằng tay ("Tôi đã thấy tiền về").
 * Cả hai đều lưu dữ liệu xuống máy (attachStorage) để đăng xuất / tắt app / cập nhật app không mất,
 * và sao lưu / khôi phục bằng file (exportBackup / restoreBackup).
 */
import { buildVietQr } from '../../supabase/functions/_shared/vietqr';
import { bankDisplayName } from '../../supabase/functions/_shared/banks';
import { addDays, vnDay, vnDayRange } from './time';
import { readLicense, shopKey } from '../features/plan/license';

type Row = Record<string, any>;
type Result = { data: any; error: { message: string } | null; count?: number };

const DEMO_BIN = '970422';
const DEMO_ACCOUNT = '0903456789';
// Bản kiểm thử tự động đặt dài hơn để kịp thử "xác nhận tay" và "hủy đơn" trước khi khách "chuyển"
const CUSTOMER_PAYS_AFTER_MS = Number(process.env.EXPO_PUBLIC_DEMO_PAY_MS ?? 12000) || 12000;
/** Có dữ liệu mẫu + giả lập khách chuyển khoản. Bản phát hành chưa có máy chủ đặt EXPO_PUBLIC_DEMO_SAMPLE=0. */
let SAMPLE = process.env.EXPO_PUBLIC_DEMO_SAMPLE !== '0';
export const isSampleMode = () => SAMPLE;
/** Chỉ cho test: đổi kiểu chạy. */
export function setSampleMode(on: boolean) {
  SAMPLE = on;
}

const uid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const orderCode = () => Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const nowIso = () => new Date().toISOString();

// ---------------- Lịch sử lớn (thử dữ liệu hàng trăm nghìn – hàng triệu đơn) ----------------
// EXPO_PUBLIC_DEMO_BULK_ORDERS=1000000: quán đầu tiên có thêm chừng ấy đơn cũ, rải đều 365 ngày, từ HÔM KIA trở về
// trước (hôm nay và hôm qua giữ như bản thử thường). Không giữ cả triệu dòng trong bộ nhớ: mỗi ngày sinh lại
// từ hạt giống cố định khi cần (giống hệt mỗi lần), tổng theo ngày được nhớ lại sau lần tính đầu.
export const BULK_ORDERS = Math.max(0, Math.floor(Number(process.env.EXPO_PUBLIC_DEMO_BULK_ORDERS ?? 0) || 0));
const BULK_DAYS = 365;
const BULK_FIRST_OFFSET = 2;
let bulkBiz: string | null = null;
let bulkToday = '';
const bulkSums = new Map<string, Row[]>();
const bulkRows = new Map<string, Row[]>();

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ngày cũ thứ k (0 = hôm kia) và số đơn của ngày đó; tổng các ngày đúng bằng BULK_ORDERS. */
function bulkDay(k: number): { day: string; count: number } {
  const count = Math.floor((BULK_ORDERS * (k + 1)) / BULK_DAYS) - Math.floor((BULK_ORDERS * k) / BULK_DAYS);
  return { day: addDays(bulkToday, -(BULK_FIRST_OFFSET + k)), count };
}

function generateBulkDay(k: number): Row[] {
  const { day, count } = bulkDay(k);
  const rnd = mulberry32(0x9e3779b1 ^ (k * 2654435761));
  const start = Date.parse(vnDayRange(day).from);
  const compact = day.replace(/-/g, '');
  const rows: Row[] = new Array(count);
  for (let j = 0; j < count; j++) {
    const soldAt = new Date(start + Math.floor(((j + rnd()) / count) * 86_400_000)).toISOString();
    const amount = (10 + Math.floor(rnd() * 190)) * 1000;
    const method = rnd() < 0.75 ? 'VIETQR' : 'CASH';
    const paid = rnd() < 0.985;
    let code = '';
    for (let c = 0; c < 8; c++) code += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)];
    rows[j] = {
      id: `h${compact}-${String(j).padStart(7, '0')}`, business_id: bulkBiz, order_code: code, total_amount: amount,
      amount_received: paid ? amount : 0, overpaid_amount: 0, payment_method: method,
      payment_status: paid ? 'PAID' : 'CANCELLED', paid_at: paid ? soldAt : null, manual_confirmed_by: null,
      manual_confirmed_at: null, manual_note: null, sold_at: soldAt, client_sold_at: soldAt, clock_suspect: false,
      created_device_id: null, created_by: null, created_at: soldAt, updated_at: soldAt,
    };
  }
  return rows;
}

/** Đơn của một ngày cũ: nhớ tối đa 3 ngày gần nhất được xem. */
function bulkRowsFor(k: number): Row[] {
  const key = String(k);
  let rows = bulkRows.get(key);
  if (!rows) {
    rows = generateBulkDay(k);
    bulkRows.set(key, rows);
    if (bulkRows.size > 3) bulkRows.delete(bulkRows.keys().next().value as string);
  }
  return rows;
}

/** Dòng daily_sales của một ngày cũ (chỉ tính một lần). */
function bulkSumsFor(k: number): Row[] {
  const key = bulkDay(k).day;
  let sums = bulkSums.get(key);
  if (!sums) {
    const by = new Map<string, Row>();
    for (const o of bulkRows.get(String(k)) ?? generateBulkDay(k)) {
      if (o.payment_status !== 'PAID') continue;
      const r = by.get(o.payment_method) ?? { business_id: bulkBiz, sale_date: key, method: o.payment_method, orders_count: 0, amount: 0 };
      r.orders_count += 1;
      r.amount += o.total_amount;
      by.set(o.payment_method, r);
    }
    sums = [...by.values()];
    bulkSums.set(key, sums);
  }
  return sums;
}

/** Các ngày cũ (chỉ số k) nằm trong [fromDay, toDay], mới nhất trước. */
function bulkDaysBetween(fromDay: string, toDay: string): number[] {
  const out: number[] = [];
  if (!bulkBiz || BULK_ORDERS === 0) return out;
  for (let k = 0; k < BULK_DAYS; k++) {
    const d = bulkDay(k).day;
    if (d > toDay) continue;
    if (d < fromDay) break;
    out.push(k);
  }
  return out;
}

// ---------------- Dữ liệu trong bộ nhớ ----------------
const TABLES = {
  businesses: [],
  business_members: [],
  payment_accounts: [],
  orders: [],
  payment_events: [],
  user_consents: [],
  debt_customers: [],
  debt_entries: [],
  journal_entries: [],
  products: [],
  stock_movements: [],
  stock_lots: [],
  order_items: [],
  cash_shifts: [],
  business_invites: [],
  crm_customers: [],
  loyalty_events: [],
  invoices: [],
  invoice_lines: [],
} as Record<string, Row[]>;

// ---------------- Theo dõi thay đổi để chỉ ghi phần đổi (không ghi lại cả kho mỗi lần bán) ----------------
// Mỗi bảng là mảng bọc Proxy: thêm / sửa một dòng thì đánh dấu đúng dòng đó; thay cả mảng hoặc xóa dòng thì ghi lại cả bảng
// (chỉ xảy ra ở bảng nhỏ: thành viên, hàng hóa…). Bảng lớn (đơn, dòng đơn, phiếu kho) chỉ thêm và sửa.
const dirtyRows = new Map<string, Set<string>>();
const dirtyTables = new Set<string>();
const proxied = new WeakSet<object>();
const rowIndex = new WeakMap<object, number>();
let ordersVersion = 0;
/** Chỉ mục theo id cho mọi bảng + dòng đơn theo đơn (tránh quét cả bảng ở mỗi lần bán / mỗi lần ghi) */
const byId = new Map<string, Map<string, Row>>();
const itemsByOrder = new Map<string, Row[]>();
const ordersByDay = new Map<string, Row[]>();
/** daily_sales cộng dồn: mỗi đơn đóng góp vào đúng một ô (quán|ngày|cách trả); đơn đổi thì trừ phần cũ, cộng phần mới */
const salesAgg = new Map<string, Row>();
const contrib = new Map<string, { k: string; amt: number }>();
function applyOrderAgg(o: Row) {
  const old = contrib.get(o.id);
  if (old) {
    const r = salesAgg.get(old.k);
    if (r) {
      r.orders_count -= 1;
      r.amount -= old.amt;
      if (r.orders_count <= 0) salesAgg.delete(old.k);
    }
    contrib.delete(o.id);
  }
  if (o.payment_status !== 'PAID' || typeof o.sold_at !== 'string') return;
  const day = dayOf(o.sold_at);
  const k = `${o.business_id}|${day}|${o.payment_method}`;
  const r = salesAgg.get(k) ?? { business_id: o.business_id, sale_date: day, method: o.payment_method, orders_count: 0, amount: 0 };
  r.orders_count += 1;
  r.amount += o.total_amount;
  salesAgg.set(k, r);
  contrib.set(o.id, { k, amt: o.total_amount });
}

function indexRow(t: string, r: Row) {
  if (typeof r.id === 'string') {
    let m = byId.get(t);
    if (!m) byId.set(t, (m = new Map()));
    m.set(r.id, r);
  }
  if (t === 'orders' && typeof r.sold_at === 'string') {
    const k = `${r.business_id}|${dayOf(r.sold_at)}`;
    const list = ordersByDay.get(k);
    if (list) {
      if (!list.includes(r)) list.push(r);
    } else ordersByDay.set(k, [r]);
    applyOrderAgg(r);
  }
  if (t === 'order_items' && typeof r.order_id === 'string') {
    const list = itemsByOrder.get(r.order_id);
    if (list) {
      if (!list.includes(r)) list.push(r);
    } else itemsByOrder.set(r.order_id, [r]);
  }
}

function markRow(t: string, raw: Row) {
  if (t === 'orders') {
    ordersVersion++;
    if (typeof raw.id === 'string') applyOrderAgg(raw);
  }
  const k = typeof raw.id === 'string' ? raw.id : null;
  if (!k) dirtyTables.add(t);
  else {
    let set = dirtyRows.get(t);
    if (!set) dirtyRows.set(t, (set = new Set()));
    set.add(k);
  }
  scheduleSave();
}

function wrapRow(t: string, r: Row): Row {
  if (proxied.has(r)) return r;
  const px = new Proxy(r, {
    set(o, k, v) {
      (o as Row)[k as string] = v;
      markRow(t, o);
      return true;
    },
    deleteProperty(o, k) {
      delete (o as Row)[k as string];
      markRow(t, o);
      return true;
    },
  });
  proxied.add(px);
  return px;
}

function wrapTable(t: string, arr: Row[]): Row[] {
  const a = arr.map((r) => wrapRow(t, r));
  a.forEach((r, i) => rowIndex.set(r, i));
  byId.set(t, new Map());
  if (t === 'order_items') itemsByOrder.clear();
  if (t === 'orders') {
    ordersByDay.clear();
    salesAgg.clear();
    contrib.clear();
  }
  for (const r of a) indexRow(t, r);
  if (t === 'orders') ordersVersion++;
  return new Proxy(a, {
    set(o, k, v) {
      if (k === 'length') {
        if ((v as number) < o.length) dirtyTables.add(t);
        o.length = v as number;
        return true;
      }
      const i = typeof k === 'string' ? Number(k) : NaN;
      if (Number.isInteger(i) && v && typeof v === 'object') {
        const w = wrapRow(t, v as Row);
        o[i] = w;
        rowIndex.set(w, i);
        indexRow(t, w);
        markRow(t, w);
        return true;
      }
      (o as unknown as Record<string | symbol, unknown>)[k] = v;
      return true;
    },
    deleteProperty(o, k) {
      delete (o as unknown as Record<string | symbol, unknown>)[k];
      dirtyTables.add(t);
      return true;
    },
  });
}

const db: Record<string, Row[]> = new Proxy({} as Record<string, Row[]>, {
  set(o, t, v) {
    o[t as string] = wrapTable(t as string, v as Row[]);
    dirtyTables.add(t as string);
    return true;
  },
});
for (const [t, rows] of Object.entries(TABLES)) db[t] = rows;
dirtyTables.clear();

/** Tìm đơn theo id không phải quét cả bảng */
const findOrder = (id: string): Row | undefined => byId.get('orders')?.get(id);
const findRow = (t: string, id: string): Row | undefined => byId.get(t)?.get(id);
const orderItems = (orderId: string): Row[] => itemsByOrder.get(orderId) ?? [];

let user: { id: string; phone: string } | null = null;

// ---------------- Lưu xuống máy ----------------
export interface LocalStorageAdapter {
  load(): string | null;
  save(json: string): void;
}

/** Lưu từng dòng (SQLite): chỉ ghi dòng đổi; bảng thay cả thì ghi lại cả bảng. */
export interface RowStoreAdapter {
  /** Toàn bộ dòng đã lưu, theo bảng và thứ tự */
  loadRows(): { t: string; k: string; n: number; j: string }[];
  loadMeta(): string | null;
  apply(c: {
    replace: { t: string; rows: { k: string; n: number; j: string }[] }[];
    upsert: { t: string; k: string; n: number; j: string }[];
    meta: string;
  }): void;
  /** Bản lưu cả khối cũ (trước khi chuyển sang lưu từng dòng) để chuyển dữ liệu một lần */
  legacyLoad(): string | null;
  legacyClear(): void;
}
const SNAPSHOT_VERSION = 1;
let storage: LocalStorageAdapter | null = null;
let rowStore: RowStoreAdapter | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function snapshot(): string {
  return JSON.stringify({ v: SNAPSHOT_VERSION, user, db });
}

function applyTables(tables: Record<string, Row[]>) {
  for (const k of Object.keys(db)) db[k] = Array.isArray(tables[k]) ? tables[k]!.map((r) => ({ ...r })) : [];
}

/** Gắn nơi lưu (SQLite trên máy) và nạp lại dữ liệu đã lưu. Gọi một lần lúc mở app. */
export function attachStorage(s: LocalStorageAdapter) {
  storage = s;
  rowStore = null;
  try {
    const raw = s.load();
    if (raw) {
      const snap = JSON.parse(raw) as { v: number; user: typeof user; db: Record<string, Row[]> };
      if (snap && snap.v === SNAPSHOT_VERSION && snap.db) {
        applyTables(snap.db);
        user = snap.user ?? null;
      }
    }
  } catch {
    // Dữ liệu lưu hỏng: giữ nguyên bản trong máy, không ghi đè cho tới lần ghi kế tiếp
  }
  dirtyTables.clear();
  dirtyRows.clear();
}

/** Gắn kho lưu từng dòng (SQLite) và nạp lại; chuyển một lần từ bản lưu cả khối cũ nếu có. */
export function attachRowStore(rs: RowStoreAdapter) {
  rowStore = rs;
  storage = null;
  try {
    const rows = rs.loadRows();
    if (rows.length === 0) {
      const legacy = rs.legacyLoad();
      if (legacy) {
        const snap = JSON.parse(legacy) as { v: number; user: typeof user; db: Record<string, Row[]> };
        if (snap?.v === SNAPSHOT_VERSION && snap.db) {
          applyTables(snap.db);
          user = snap.user ?? null;
          for (const t of Object.keys(db)) dirtyTables.add(t);
          writeRows();
          rs.legacyClear();
        }
      }
    } else {
      const byTable: Record<string, Row[]> = {};
      for (const r of rows) (byTable[r.t] ??= []).push(JSON.parse(r.j));
      applyTables(byTable);
      const meta = rs.loadMeta();
      user = meta ? ((JSON.parse(meta) as { user: typeof user }).user ?? null) : null;
    }
  } catch {
    // Kho lỗi: chạy với dữ liệu trống trong phiên này, không ghi đè kho cũ cho tới lần ghi kế tiếp
  }
  dirtyTables.clear();
  dirtyRows.clear();
}

function writeRows() {
  if (!rowStore) return;
  const replace = [...dirtyTables].map((t) => ({
    t,
    rows: (db[t] ?? []).map((r, i) => ({ k: typeof r.id === 'string' ? r.id : `#${i}`, n: i, j: JSON.stringify(r) })),
  }));
  const upsert: { t: string; k: string; n: number; j: string }[] = [];
  for (const [t, keys] of dirtyRows) {
    if (dirtyTables.has(t)) continue;
    for (const k of keys) {
      const r = findRow(t, k);
      if (r) upsert.push({ t, k, n: rowIndex.get(r) ?? 0, j: JSON.stringify(r) });
    }
  }
  dirtyTables.clear();
  dirtyRows.clear();
  rowStore.apply({ replace, upsert, meta: JSON.stringify({ v: SNAPSHOT_VERSION, user }) });
}

function scheduleSave() {
  if ((!storage && !rowStore) || saveTimer) return;
  saveTimer = setTimeout(() => persistNow(true), 300);
}

/** Ghi xuống máy (gộp nhiều thay đổi liên tiếp). flush=true: ghi ngay (app sắp vào nền). */
export function persistNow(flush = false) {
  if (!storage && !rowStore) return;
  if (!flush) {
    scheduleSave();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    if (rowStore) writeRows();
    else storage?.save(snapshot());
  } catch {
    // Hết chỗ trống / lỗi ghi: lần sau thử lại
  }
}

// ---------------- Sao lưu / khôi phục bằng file ----------------
export interface BackupFile {
  app: 'QuickPOS';
  kind: 'backup';
  version: number;
  created_at: string;
  business_id: string;
  business_name: string;
  orders: number;
  tables: Record<string, Row[]>;
}

/** Bản sao lưu một quán: mọi bảng của quán đó (dòng đơn, dòng hóa đơn theo đơn/hóa đơn của quán). */
export function exportBackup(bizId: string): BackupFile {
  const b = db.businesses!.find((x) => x.id === bizId);
  if (!b) throw new Error('QP_NOT_FOUND');
  const tables: Record<string, Row[]> = {};
  const orderIds = new Set(db.orders!.filter((o) => o.business_id === bizId).map((o) => o.id));
  const invoiceIds = new Set(db.invoices!.filter((i) => i.business_id === bizId).map((i) => i.id));
  for (const [k, rows] of Object.entries(db)) {
    if (k === 'user_consents') continue;
    if (k === 'order_items') tables[k] = rows.filter((r) => orderIds.has(r.order_id));
    else if (k === 'invoice_lines') tables[k] = rows.filter((r) => invoiceIds.has(r.invoice_id));
    else if (k === 'businesses') tables[k] = rows.filter((r) => r.id === bizId);
    else tables[k] = rows.filter((r) => r.business_id === bizId);
  }
  return {
    app: 'QuickPOS', kind: 'backup', version: SNAPSHOT_VERSION, created_at: nowIso(), business_id: bizId,
    business_name: b.business_name, orders: orderIds.size, tables: JSON.parse(JSON.stringify(tables)),
  };
}

/** Đọc và kiểm tra file sao lưu; sai định dạng → null. */
export function parseBackup(text: string): BackupFile | null {
  try {
    const f = JSON.parse(text) as BackupFile;
    if (f?.app !== 'QuickPOS' || f.kind !== 'backup' || f.version !== SNAPSHOT_VERSION || !f.tables?.businesses?.length) return null;
    if (!f.tables.businesses.some((b) => b.id === f.business_id)) return null;
    return f;
  } catch {
    return null;
  }
}

/**
 * Khôi phục: thay TOÀN BỘ dữ liệu trên máy bằng bản sao lưu; người đang đăng nhập thành chủ quán
 * (máy mới có thể đăng nhập bằng số điện thoại khác). Ghi xuống máy ngay.
 */
export function restoreBackup(f: BackupFile): { businessId: string } {
  if (!user) throw new Error('QP_UNAUTHENTICATED');
  const consents = db.user_consents!.filter((c) => c.user_id === user!.id);
  applyTables(f.tables);
  db.user_consents = consents;
  const b = db.businesses!.find((x) => x.id === f.business_id)!;
  const oldOwner = b.owner_id;
  b.owner_id = user.id;
  // Nhân viên của máy cũ không có trên máy này: chỉ giữ chủ quán (là người đang đăng nhập)
  db.business_members = [{ business_id: b.id, user_id: user.id, role: 'OWNER', created_at: nowIso() }];
  for (const t of ['orders', 'debt_entries', 'journal_entries', 'cash_shifts']) {
    for (const r of db[t] ?? []) if (r.created_by && r.created_by === oldOwner) r.created_by = user.id;
  }
  persistNow(true);
  return { businessId: b.id };
}

// ---------------- Máy chủ quán (gói Pro) ----------------
const READ_METHODS = new Set(['select', 'eq', 'is', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'limit', 'single', 'maybeSingle']);

/** Thêm máy nhân viên làm thành viên của quán (user_id 'lan-<máy>'). */
export function addLanMember(bizId: string, userId: string, role: string, name: string) {
  db.business_members = db.business_members!.filter((m) => !(m.business_id === bizId && m.user_id === userId));
  db.business_members.push({ business_id: bizId, user_id: userId, role, member_phone: null, member_name: name, created_at: nowIso() });
  persistNow(true);
}

export function removeLanMember(bizId: string, userId: string) {
  db.business_members = db.business_members!.filter((m) => !(m.business_id === bizId && m.user_id === userId));
  persistNow(true);
}

/** Nghe mọi đơn đổi trạng thái (máy chủ quán đẩy cho máy nhân viên). */
export function onAnyOrder(cb: (row: Row) => void): () => void {
  const h = (p: { new: Row }) => cb(p.new);
  orderListeners.add(h);
  return () => {
    orderListeners.delete(h);
  };
}

/**
 * Chạy một lệnh của máy nhân viên như người dùng userId (đổi người dùng tạm thời trong lúc chạy đồng bộ,
 * nên không lẫn với chủ quán đang dùng máy chủ quán).
 */
export async function hostExecute(
  userId: string,
  req: { kind: 'rpc'; name: string; args: Row } | { kind: 'select'; table: string; ops: { m: string; a: unknown[] }[] } | { kind: 'fn'; name: string; body: Row },
  invoke: (name: string, opts: { body: Row }) => Promise<{ data: unknown; error: { message: string } | null }>,
): Promise<Result> {
  if (!db.business_members!.some((m) => m.user_id === userId)) return fail('QP_UNAUTHENTICATED');
  const saved = user;
  if (req.kind === 'rpc') {
    // Không cho máy nhân viên tự đổi gói, đổi tài khoản nhận tiền, tạo quán
    if (['start_pro_trial_v1', 'set_pro_license_v1', 'set_local_payment_account_v1', 'create_business_v1'].includes(req.name)) return fail('QP_FORBIDDEN');
    user = { id: userId, phone: '' };
    try {
      const r = rpcImpl(req.name, req.args ?? {});
      if (!r.error) persistNow();
      return r;
    } finally {
      user = saved;
    }
  }
  if (req.kind === 'select') {
    let q: Row = new Query(req.table);
    for (const op of req.ops ?? []) {
      if (!READ_METHODS.has(op.m)) return fail('QP_FORBIDDEN');
      q = q[op.m](...(op.a ?? []));
    }
    user = { id: userId, phone: '' };
    try {
      return (q as Query).runNow();
    } finally {
      user = saved;
    }
  }
  if (req.kind === 'fn') return (await invoke(req.name, { body: req.body ?? {} })) as Result;
  return fail('QP_INVALID_INPUT');
}

const authListeners = new Set<(event: string, session: unknown) => void>();
const orderListeners = new Set<(payload: { new: Row }) => void>();

const fail = (message: string): Result => ({ data: null, error: { message } });
const ok = (data: unknown): Result => ({ data, error: null });

function session() {
  return user ? { access_token: 'demo', user: { id: user.id, phone: user.phone } } : null;
}

function emitOrder(o: Row) {
  for (const l of orderListeners) l({ new: { ...o } });
}

function newOrder(bizId: string, items: Row[], method: string, deviceId: string | null, soldAt?: string): Row {
  const total = items.reduce((s, i) => s + Math.round(Number(i.quantity) * Number(i.unit_price)), 0);
  const t = nowIso();
  return {
    id: uid(), business_id: bizId, order_code: orderCode(), total_amount: total, amount_received: 0, overpaid_amount: 0,
    payment_method: method, payment_status: 'UNPAID', paid_at: null, manual_confirmed_by: null, manual_confirmed_at: null,
    manual_note: null, sold_at: soldAt ?? t, client_sold_at: soldAt ?? t, clock_suspect: false, created_device_id: deviceId,
    created_by: user?.id ?? null, created_at: t, updated_at: t,
  };
}

function updateOrder(raw: Row, patch: Row) {
  // Luôn sửa qua bản bọc trong bảng (bản gốc giữ trong hẹn giờ không được theo dõi thay đổi)
  const o = findOrder(raw.id) ?? raw;
  const wasPaid = o.payment_status === 'PAID';
  Object.assign(o, patch, { updated_at: nowIso() });
  o.overpaid_amount = Math.max(o.amount_received - o.total_amount, 0);
  if (!wasPaid && o.payment_status === 'PAID') onPaid(o);
  emitOrder(o);
  persistNow();
}

function saveItems(orderId: string, items: Row[]) {
  for (const i of items) {
    const quantity = Number(i.quantity);
    const unit_price = Number(i.unit_price);
    db.order_items!.push({ id: uid(), order_id: orderId, product_id: i.product_id ?? null, name: String(i.name).trim(), quantity, unit_price, line_amount: Math.round(quantity * unit_price) });
  }
}

/** Đơn vừa trả xong: trừ kho món có theo dõi, cộng điểm khách quen, trừ sổ nợ (đơn thu nợ bằng QR). */
function onPaid(o: Row) {
  const byProduct = new Map<string, number>();
  for (const it of orderItems(o.id).filter((x) => x.product_id)) byProduct.set(it.product_id, (byProduct.get(it.product_id) ?? 0) + it.quantity);
  for (const [pid, qty] of byProduct) {
    const p = db.products!.find((x) => x.id === pid);
    if (!p?.track_stock || db.stock_movements!.some((m) => m.kind === 'SALE' && m.order_id === o.id && m.product_id === pid)) continue;
    db.stock_movements!.push({ id: uid(), business_id: o.business_id, product_id: pid, kind: 'SALE', qty: -qty, unit_cost: null, order_id: o.id, note: null, created_at: nowIso() });
    p.stock_qty = Math.round((p.stock_qty - qty) * 1000) / 1000;
    trimLots(p);
  }
  awardPoints(o);
  if (o.debt_customer_id && !db.debt_entries!.some((e) => e.id === o.id)) {
    db.debt_entries!.push({ id: o.id, business_id: o.business_id, customer_id: o.debt_customer_id, kind: 'PAYMENT', amount: o.total_amount,
      note: `Trả nợ qua chuyển khoản · đơn ${o.order_code}`, entry_date: vnDay(), created_at: nowIso(), voided_at: null });
  }
}

function awardPoints(o: Row) {
  if (!o.customer_id || o.payment_status !== 'PAID' || db.loyalty_events!.some((e) => e.kind === 'EARN' && e.order_id === o.id)) return;
  const b = db.businesses!.find((x) => x.id === o.business_id);
  const rate = b?.loyalty_vnd_per_point ?? 10000;
  const pts = rate > 0 ? Math.floor(o.total_amount / rate) : 0;
  db.loyalty_events!.push({ id: uid(), business_id: o.business_id, customer_id: o.customer_id, order_id: o.id, kind: 'EARN', points: Math.max(pts, 1), note: `Đơn ${o.order_code}`, created_at: nowIso() });
  const c = db.crm_customers!.find((x) => x.id === o.customer_id);
  if (c) Object.assign(c, { points: c.points + pts, total_spent: c.total_spent + o.total_amount, visits: c.visits + 1, last_visit_at: o.sold_at });
}

const debtBalanceOf = (customerId: string) =>
  db.debt_entries!.filter((e) => e.customer_id === customerId && !e.voided_at).reduce((s, e) => s + (e.kind === 'DEBT' ? e.amount : -e.amount), 0);

/** Đơn đã trả trong khoảng [from, to): đơn thật + đơn cũ sinh sẵn (bản dùng thử dữ liệu lớn). */
function paidOrdersBetween(bizId: string, from: string, to: string): Row[] {
  const rows = db.orders!.filter((o) => o.business_id === bizId && o.payment_status === 'PAID' && o.sold_at >= from && o.sold_at < to);
  if (bizId === bulkBiz) {
    for (const k of bulkDaysBetween(vnDay(new Date(from)), vnDay(new Date(Date.parse(to) - 1)))) {
      for (const o of bulkRowsFor(k)) if (o.payment_status === 'PAID' && o.sold_at >= from && o.sold_at < to) rows.push(o);
    }
  }
  return rows;
}

/** Dữ liệu mẫu cho quán mới tạo: tài khoản nhận tiền, vài đơn hôm nay, một khoản tiền chưa rõ đơn. */
function seedBusiness(bizId: string) {
  db.payment_accounts!.push({ id: uid(), business_id: bizId, provider: 'DEMO', bank_bin: DEMO_BIN, account_no: DEMO_ACCOUNT, kind: 'MAIN', label: null, is_active: true });
  // Giờ mẫu "cách đây m phút" nhưng không lùi qua nửa đêm (mở app lúc 0 giờ vẫn ra sổ hôm nay đúng)
  const dayStart = Date.parse(vnDayRange(vnDay()).from);
  const span = Math.max(Date.now() - dayStart, 1);
  const minutesAgo = (m: number) => new Date(Date.now() - Math.min(m * 60_000, (span * m) / 100)).toISOString();
  const samples: [number, string, number][] = [[25000, 'VIETQR', 95], [18000, 'CASH', 80], [45000, 'VIETQR', 62], [12000, 'CASH', 40], [30000, 'VIETQR', 21]];
  for (const [amount, method, ago] of samples) {
    const o = newOrder(bizId, [{ name: 'Bán hàng', quantity: 1, unit_price: amount }], method, null, minutesAgo(ago));
    Object.assign(o, { payment_status: 'PAID', amount_received: amount, paid_at: minutesAgo(ago - 1), created_at: minutesAgo(ago) });
    db.orders!.push(o);
  }
  // Một đơn 18.000 đ khách chưa trả (để thử "Gán vào đơn")
  const unpaid = newOrder(bizId, [{ name: 'Bán hàng', quantity: 1, unit_price: 18000 }], 'VIETQR', null, minutesAgo(16));
  unpaid.created_at = minutesAgo(16);
  db.orders!.push(unpaid);
  db.payment_events!.push({
    id: uid(), business_id: bizId, order_id: null, provider: 'DEMO', bank_bin: DEMO_BIN, account_no: DEMO_ACCOUNT,
    amount: 18000, transfer_content: 'chuyen tien', match_status: 'UNMATCHED', received_at: minutesAgo(15),
  });
  if (BULK_ORDERS > 0 && !bulkBiz) {
    bulkBiz = bizId;
    bulkToday = vnDay();
    bulkSums.clear();
    bulkRows.clear();
  }
}

function paidRowsFor(bizId: string) {
  return db.orders!.filter((o) => o.business_id === bizId && o.payment_status === 'PAID');
}

const dayCache = new Map<string, string>();
function dayOf(soldAt: string): string {
  let d = dayCache.get(soldAt);
  if (!d) {
    d = vnDay(new Date(soldAt));
    if (dayCache.size > 200_000) dayCache.clear();
    dayCache.set(soldAt, d);
  }
  return d;
}

function dailySales(): Row[] {
  return [...salesAgg.values()].map((r) => ({ ...r }));
}


/** daily_sales của ngày cũ trong khoảng ngày (mặc định cả năm). */
function bulkDailySales(fromDay = '0000-00-00', toDay = '9999-99-99'): Row[] {
  return bulkDaysBetween(fromDay, toDay).flatMap((k) => bulkSumsFor(k));
}

function tableRows(table: string, range?: { from?: string; to?: string }): Row[] {
  if (table === 'daily_sales') return [...dailySales(), ...bulkDailySales(range?.from, range?.to)];
  if (table === 'unreconciled_manual_confirmations') {
    const cutoff = Date.now() - 15 * 60_000;
    return db.orders!.filter((o) => o.manual_confirmed_at && o.amount_received < o.total_amount && Date.parse(o.manual_confirmed_at) < cutoff);
  }
  if (table === 'debt_balances') return debtBalances();
  return db[table] ?? [];
}

/** View debt_balances: số dư nợ từng khách (bỏ dòng đã hủy). */
function debtBalances(): Row[] {
  return db.debt_customers!.map((c) => {
    const rows = db.debt_entries!.filter((e) => e.customer_id === c.id && !e.voided_at);
    const balance = rows.reduce((s, e) => s + (e.kind === 'DEBT' ? e.amount : -e.amount), 0);
    const last = rows.reduce<string | null>((m, e) => (!m || e.created_at > m ? e.created_at : m), null);
    return { customer_id: c.id, business_id: c.business_id, name: c.name, phone: c.phone, balance, last_entry_at: last };
  });
}

/** Như trigger trim_lots_to_stock: tổng lô không vượt tồn kho, trừ lô hết hạn sớm trước. */
function trimLots(p: Row) {
  const lots = db.stock_lots!
    .filter((l) => l.product_id === p.id && l.qty_left > 0)
    .sort((a, b) => (a.expires_on ?? '9999') .localeCompare(b.expires_on ?? '9999') || a.created_at.localeCompare(b.created_at));
  let excess = lots.reduce((t, l) => t + l.qty_left, 0) - Math.max(p.stock_qty, 0);
  for (const l of lots) {
    if (excess <= 0) break;
    const take = Math.min(l.qty_left, excess);
    l.qty_left = Math.round((l.qty_left - take) * 1000) / 1000;
    excess -= take;
  }
}

const VALID_CODE = /^[0-9A-Za-z._/:+-]{3,64}$/;

/** Dữ liệu mẫu cho sổ nợ và chi tiêu (để màn hình báo cáo có lãi/chi ngay khi dùng thử). */
function seedShop(bizId: string) {
  const today = vnDay();
  const at = new Date(Math.min(Date.parse(vnDayRange(today).from) + 7 * 3_600_000, Date.now() - 120_000)).toISOString();
  const product = (name: string, price: number, unit: string, category: string, track: boolean, stock: number, low: number | null,
    extra: { barcode?: string; cost?: number; expiry?: boolean } = {}) => {
    const id = uid();
    db.products!.push({ id, business_id: bizId, name, unit, price, category, cost_price: extra.cost ?? null, track_stock: track, stock_qty: stock,
      low_stock_at: low, is_active: true, sort_order: 0, barcode: extra.barcode ?? null, track_expiry: !!extra.expiry, expiry_warn_days: 7,
      archived_at: null });
    return id;
  };
  const stockIn = (pid: string, qty: number, cost: number | null, expires: string | null) => {
    const id = uid();
    db.stock_movements!.push({ id, business_id: bizId, product_id: pid, kind: 'IN', qty, unit_cost: cost, order_id: null, note: null,
      reason: null, lot_id: expires ? id : null, created_at: at });
    if (expires) db.stock_lots!.push({ id, business_id: bizId, product_id: pid, expires_on: expires, qty_in: qty, qty_left: qty, created_at: at });
  };
  product('Cà phê sữa', 20000, 'ly', 'Đồ uống', false, 0, null);
  product('Trà đá', 5000, 'ly', 'Đồ uống', false, 0, null);
  stockIn(product('Bánh mì', 15000, 'ổ', 'Đồ ăn', true, 20, 5, { cost: 9000 }), 20, 9000, null);
  stockIn(product('Nước suối', 10000, 'chai', 'Đồ uống', true, 24, 6, { barcode: '8936017366070', cost: 5000 }), 24, 5000, null);
  // Sữa có hạn dùng: một lô còn 2 ngày (để thấy cảnh báo sắp hết hạn), một lô còn 40 ngày
  const sua = product('Sữa tươi hộp', 9000, 'hộp', 'Sữa', true, 18, 4, { barcode: '8934673573189', cost: 7000, expiry: true });
  stockIn(sua, 6, 7000, addDays(today, 2));
  stockIn(sua, 12, 7000, addDays(today, 40));
  db.crm_customers!.push({ id: uid(), business_id: bizId, display_name: 'Anh Bảy', phone_number: '0911222333', consent_at: nowIso(),
    consent_source: 'app_khach_quen', points: 35, total_spent: 380000, visits: 4, last_visit_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), created_at: nowIso() });
}

function seedBooks(bizId: string) {
  const today = vnDay();
  const iso = (d: string, h: number) => new Date(Date.parse(vnDayRange(d).from) + h * 3_600_000).toISOString();
  const hoa = { id: uid(), business_id: bizId, name: 'Chị Hoa', phone: '0903111222', consent_at: nowIso(), consent_source: 'app_so_no', created_at: nowIso() };
  const tu = { id: uid(), business_id: bizId, name: 'Anh Tư xe ôm', phone: null, consent_at: null, consent_source: null, created_at: nowIso() };
  db.debt_customers!.push(hoa, tu);
  const entry = (c: Row, kind: string, amount: number, note: string | null, day: string, h: number) =>
    db.debt_entries!.push({ id: uid(), business_id: bizId, customer_id: c.id, kind, amount, note, entry_date: day, created_at: iso(day, h), voided_at: null });
  entry(hoa, 'DEBT', 120000, 'Gạo, nước mắm', addDays(today, -3), 9);
  entry(hoa, 'PAYMENT', 35000, null, addDays(today, -1), 17);
  entry(tu, 'DEBT', 40000, 'Thuốc lá', addDays(today, -2), 7);
  const expense = (amount: number, category: string, description: string | null, day: string) =>
    db.journal_entries!.push({ id: uid(), business_id: bizId, entry_type: 'EXPENSE', amount, category, description, source: 'MANUAL',
      source_id: uid(), entry_date: day, created_at: new Date(Math.min(Date.parse(iso(day, 8)), Date.now() - 60_000)).toISOString(), voided_at: null });
  expense(450000, 'Nhập hàng', 'Bia, nước ngọt', addDays(today, -2));
  expense(35000, 'Khác', 'Đá, ly nhựa', today);
}

// ---------------- Truy vấn bảng (chuỗi .eq().in().order()… như supabase-js) ----------------
class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private sort: { col: string; asc: boolean } | null = null;
  private max = Infinity;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private cols = '*';
  constructor(private table: string) {}
  select(cols = '*') { this.cols = cols; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  private range: { from?: string; to?: string } = {};
  gte(c: string, v: string | number) {
    if (c === 'sale_date') this.range.from = String(v);
    this.filters.push((r) => r[c] >= v);
    return this;
  }
  lte(c: string, v: string | number) {
    if (c === 'sale_date') this.range.to = String(v);
    this.filters.push((r) => r[c] <= v);
    return this;
  }
  lt(c: string, v: string | number) { this.filters.push((r) => r[c] < v); return this; }
  gt(c: string, v: string | number) { this.filters.push((r) => r[c] > v); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.sort = { col, asc: o?.ascending ?? true }; return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  abortSignal() { return this; }

  /** Chạy ngay (máy chủ quán trả kết quả cho máy nhân viên) */
  runNow(): Result {
    return this.run();
  }

  private run(): Result {
    let rows = tableRows(this.table, this.range).filter((r) => this.filters.every((f) => f(r)));
    if (this.sort) {
      const { col, asc } = this.sort;
      rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    rows = rows.slice(0, this.max).map((r) => this.embed({ ...r }));
    if (this.mode === 'single') return rows.length === 1 ? ok(rows[0]) : fail('QP_NOT_FOUND');
    if (this.mode === 'maybe') return ok(rows[0] ?? null);
    return ok(rows);
  }

  /** Bảng lồng nhau mà app dùng: business:businesses(...), order:orders(order_code) */
  private embed(r: Row): Row {
    if (this.cols.includes('business:businesses(')) r.business = db.businesses!.find((b) => b.id === r.business_id) ?? null;
    if (this.cols.includes('order:orders(')) {
      const o = db.orders!.find((x) => x.id === r.order_id);
      r.order = o ? { order_code: o.order_code } : null;
    }
    return r;
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, no);
  }
}

// ---------------- Hàm RPC ----------------
function rpcImpl(name: string, a: Row): Result {
  const needUser = () => (user ? null : fail('QP_UNAUTHENTICATED'));
  const member = (bizId: string) => db.business_members!.find((m) => m.business_id === bizId && m.user_id === user?.id);

  switch (name) {
    case 'check_app_version_v1':
      return ok({ must_update: false, should_update: false, latest_version: '1.0.0', store_url: null });

    case 'record_consent_v1':
      if (!user) return fail('QP_UNAUTHENTICATED');
      if (!db.user_consents!.some((c) => c.user_id === user!.id && c.policy_version === a.p_policy_version)) {
        db.user_consents!.push({ user_id: user.id, policy_version: a.p_policy_version, accepted_at: nowIso() });
      }
      return ok(null);

    case 'create_business_v1': {
      const e = needUser();
      if (e) return e;
      const existing = db.businesses!.find((b) => b.id === a.p_business_id);
      if (existing) return existing.owner_id === user!.id ? ok(existing) : fail('QP_FORBIDDEN');
      if (!/^[0-9]{10}([0-9]{2}|-[0-9]{3})?$/.test(a.p_tax_code ?? '')) return fail('QP_INVALID_INPUT');
      const b = {
        id: a.p_business_id, owner_id: user!.id, business_name: String(a.p_business_name).trim(), tax_code: a.p_tax_code,
        address: String(a.p_address).trim(), allow_cashier_manual_confirm: true, tax_industry: 'GOODS', loyalty_vnd_per_point: 10000, einvoice_provider: 'NONE', invoice_form_no: '2', invoice_symbol: null,
        bank_account_name: SAMPLE ? 'NGUYEN THI BA' : null,
      };
      db.businesses!.push(b);
      db.business_members!.push({ business_id: b.id, user_id: user!.id, role: 'OWNER', created_at: nowIso() });
      if (SAMPLE) {
        seedBusiness(b.id);
        seedBooks(b.id);
        seedShop(b.id);
      }
      return ok(b);
    }

    // Gói Pro (lưu trên máy): bắt đầu dùng thử 30 ngày — một lần cho mỗi quán
    case 'start_pro_trial_v1': {
      const m = member(a.p_business_id);
      if (!m || m.role !== 'OWNER') return fail('QP_FORBIDDEN');
      const b = db.businesses!.find((x) => x.id === a.p_business_id)!;
      if (!b.pro_trial_started_at) b.pro_trial_started_at = nowIso();
      return ok({ pro_trial_started_at: b.pro_trial_started_at, pro_license: b.pro_license ?? null });
    }

    // Gói Pro: nhập mã kích hoạt (đúng chữ ký, đúng mã quán)
    case 'set_pro_license_v1': {
      const m = member(a.p_business_id);
      if (!m || m.role !== 'OWNER') return fail('QP_FORBIDDEN');
      const lic = readLicense(String(a.p_code ?? ''));
      if (!lic) return fail('QP_LICENSE_INVALID');
      if (lic.shop !== shopKey(a.p_business_id)) return fail('QP_LICENSE_OTHER_SHOP');
      const b = db.businesses!.find((x) => x.id === a.p_business_id)!;
      b.pro_license = String(a.p_code).replace(/\s+/g, '');
      return ok({ pro_trial_started_at: b.pro_trial_started_at ?? null, pro_license: b.pro_license });
    }

    // Chỉ có ở chế độ lưu trên máy (không có cổng thanh toán xác minh tài khoản): chủ quán tự nhập tài khoản nhận tiền
    case 'set_local_payment_account_v1': {
      const m = member(a.p_business_id);
      if (!m || m.role !== 'OWNER') return fail('QP_FORBIDDEN');
      const accountNo = String(a.p_account_no ?? '').replace(/\s+/g, '');
      const name = String(a.p_account_name ?? '').trim().toUpperCase();
      if (!/^[0-9]{6}$/.test(String(a.p_bank_bin ?? '')) || !/^[0-9A-Za-z]{4,19}$/.test(accountNo) || name.length < 2 || name.length > 50)
        return fail('QP_INVALID_INPUT');
      for (const pa of db.payment_accounts!) if (pa.business_id === a.p_business_id) pa.is_active = false;
      db.payment_accounts!.push({ id: uid(), business_id: a.p_business_id, provider: 'LOCAL', bank_bin: a.p_bank_bin, account_no: accountNo,
        kind: 'MAIN', label: null, is_active: true });
      const b = db.businesses!.find((x) => x.id === a.p_business_id)!;
      b.bank_account_name = name;
      return ok({ bank_bin: a.p_bank_bin, account_no: accountNo });
    }

    case 'update_business_settings_v1': {
      const m = member(a.p_business_id);
      if (!m || !['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      const b = db.businesses!.find((x) => x.id === a.p_business_id)!;
      b.allow_cashier_manual_confirm = a.p_allow_cashier_manual_confirm;
      return ok(b);
    }

    case 'register_device_v1':
    case 'request_account_deletion_v1':
      return user ? ok({}) : fail('QP_UNAUTHENTICATED');

    case 'create_order_v1':
    case 'create_cash_sale_v1': {
      const e = needUser();
      if (e) return e;
      if (!member(a.p_business_id)) return fail('QP_FORBIDDEN');
      const existing = findOrder(a.p_order_id);
      if (existing) return ok(existing);
      const items = (a.p_items ?? []) as Row[];
      if (items.length === 0) return fail('QP_INVALID_ITEMS');
      const cash = name === 'create_cash_sale_v1';
      const o = newOrder(a.p_business_id, items, cash ? 'CASH' : 'VIETQR', a.p_device_id ?? null, a.p_sold_at);
      o.id = a.p_order_id;
      if (cash) Object.assign(o, { payment_status: 'PAID', amount_received: o.total_amount, paid_at: nowIso() });
      else if (o.total_amount <= 0) return fail('QP_INVALID_ITEMS');
      db.orders!.push(o);
      saveItems(o.id, items);
      if (cash) onPaid(o);
      if (!cash && SAMPLE) {
        // Giả lập khách quét mã và chuyển đủ tiền
        setTimeout(() => {
          const cur = findOrder(o.id);
          if (cur && cur.payment_status === 'UNPAID' && cur.amount_received === 0) {
            updateOrder(cur, { amount_received: cur.total_amount, payment_status: 'PAID', paid_at: nowIso() });
          }
        }, CUSTOMER_PAYS_AFTER_MS);
      }
      return ok({ ...o });
    }

    case 'cancel_order_v1': {
      const o = findOrder(a.p_order_id);
      if (!o) return fail('QP_NOT_FOUND');
      if (o.payment_status === 'CANCELLED') return ok({ ...o });
      if (o.payment_status !== 'UNPAID' || o.amount_received > 0) return fail('QP_ORDER_NOT_CANCELLABLE');
      updateOrder(o, { payment_status: 'CANCELLED' });
      return ok({ ...o });
    }

    case 'confirm_transfer_manually_v1': {
      const o = findOrder(a.p_order_id);
      if (!o) return fail('QP_NOT_FOUND');
      if (o.payment_status === 'PAID') return ok({ ...o });
      if (o.payment_status !== 'UNPAID') return fail('QP_ORDER_NOT_CONFIRMABLE');
      // Lưu trên máy không có ngân hàng báo về: xác nhận tay là cách duy nhất → coi như đã nhận đủ (không vào mục "chưa thấy tiền")
      updateOrder(o, { payment_status: 'PAID', paid_at: nowIso(), manual_confirmed_by: user?.id, manual_confirmed_at: nowIso(), manual_note: a.p_note ?? null,
        ...(SAMPLE ? {} : { amount_received: o.total_amount }) });
      return ok({ ...o });
    }

    case 'assign_payment_event_v1': {
      const ev = db.payment_events!.find((x) => x.id === a.p_event_id);
      const o = findOrder(a.p_order_id);
      if (!ev || !o || ev.business_id !== o.business_id) return fail('QP_NOT_FOUND');
      if (ev.match_status !== 'UNMATCHED') return fail('QP_ALREADY_ASSIGNED');
      const received = o.amount_received + ev.amount;
      const status = received >= o.total_amount ? (received === o.total_amount ? 'MATCHED' : 'OVERPAID') : 'PARTIAL';
      updateOrder(o, received >= o.total_amount ? { amount_received: received, payment_status: 'PAID', paid_at: nowIso() } : { amount_received: received });
      Object.assign(ev, { order_id: o.id, match_status: status });
      return ok(status);
    }

    case 'day_summary': {
      return ok(
        [...dailySales(), ...(a.p_business_id === bulkBiz ? bulkDailySales(a.p_day, a.p_day) : [])].filter(
          (r) => r.business_id === a.p_business_id && r.sale_date === a.p_day,
        ),
      );
    }

    case 'list_orders': {
      const afterSold = a.p_after_sold_at ?? '9999';
      const afterId = a.p_after_id ?? '~';
      const limit = Math.min(a.p_limit ?? 20, 100);
      const before = (o: Row) => o.sold_at < afterSold || (o.sold_at === afterSold && o.id < afterId);
      const inRange = (o: Row) => o.business_id === a.p_business_id && o.sold_at >= a.p_from && o.sold_at < a.p_to;
      // Đơn trong máy: đi theo từng ngày từ mới về cũ, đủ trang thì dừng (như index (business_id, sold_at desc, id desc))
      const candidates: Row[] = [];
      {
        const fromDay = vnDay(new Date(a.p_from));
        let d = vnDay(new Date(Date.parse(a.p_to) - 1));
        let got = 0;
        for (let guard = 0; d >= fromDay && guard < 4000; guard++, d = addDays(d, -1)) {
          for (const o of ordersByDay.get(`${a.p_business_id}|${d}`) ?? []) {
            if (inRange(o) && before(o)) {
              candidates.push(o);
              got++;
            }
          }
          if (got >= limit) break;
        }
      }
      // Ngày cũ: lấy từng ngày từ mới về cũ, đủ một trang thì dừng (giống index (business_id, sold_at desc, id desc))
      if (a.p_business_id === bulkBiz) {
        let found = 0;
        for (const k of bulkDaysBetween(vnDay(new Date(a.p_from)), vnDay(new Date(Date.parse(a.p_to) - 1)))) {
          const rows = bulkRowsFor(k);
          for (let j = rows.length - 1; j >= 0; j--) {
            const o = rows[j]!;
            if (inRange(o) && before(o)) {
              candidates.push(o);
              found++;
            }
            if (found >= limit) break;
          }
          if (found >= limit) break;
        }
      }
      // Chỉ giữ `limit` đơn mới nhất (không sắp xếp cả bảng)
      const newer = (x: Row, y: Row) => x.sold_at > y.sold_at || (x.sold_at === y.sold_at && x.id > y.id);
      const top: Row[] = [];
      for (const o of candidates) {
        if (top.length === limit && !newer(o, top[top.length - 1]!)) continue;
        let i = top.length;
        while (i > 0 && newer(o, top[i - 1]!)) i--;
        top.splice(i, 0, o);
        if (top.length > limit) top.pop();
      }
      return ok(top.map((r) => ({ ...r })));
    }

    case 'update_tax_settings_v1': {
      const m = member(a.p_business_id);
      if (!m || !['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      if (!['GOODS', 'PRODUCTION', 'SERVICE', 'LEASING', 'OTHER'].includes(a.p_tax_industry)) return fail('QP_INVALID_INPUT');
      const b = db.businesses!.find((x) => x.id === a.p_business_id)!;
      b.tax_industry = a.p_tax_industry;
      return ok({ ...b });
    }

    case 'add_expense_v1': {
      const e = needUser();
      if (e) return e;
      if (!member(a.p_business_id)) return fail('QP_FORBIDDEN');
      const day = a.p_entry_date ?? vnDay();
      if (!(a.p_amount > 0) || !String(a.p_category ?? '').trim() || day > vnDay()) return fail('QP_INVALID_INPUT');
      const existing = db.journal_entries!.find((x) => x.source_id === a.p_entry_id);
      if (existing) return ok({ ...existing });
      const row = { id: uid(), business_id: a.p_business_id, entry_type: 'EXPENSE', amount: a.p_amount, category: String(a.p_category).trim(),
        description: a.p_note ? String(a.p_note).trim() || null : null, source: 'MANUAL', source_id: a.p_entry_id, entry_date: day,
        created_at: nowIso(), voided_at: null };
      db.journal_entries!.push(row);
      return ok({ ...row });
    }

    case 'void_expense_v1': {
      const m = member(a.p_business_id);
      const row = db.journal_entries!.find((x) => x.source_id === a.p_entry_id && x.business_id === a.p_business_id);
      if (!row || !m) return fail('QP_NOT_FOUND');
      if (!['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      row.voided_at = row.voided_at ?? nowIso();
      return ok({ ...row });
    }

    case 'add_debt_customer_v1': {
      const e = needUser();
      if (e) return e;
      if (!member(a.p_business_id)) return fail('QP_FORBIDDEN');
      const phone = a.p_phone ? String(a.p_phone).replace(/\s/g, '') : null;
      const name = String(a.p_name ?? '').trim();
      if (!name || name.length > 100 || (phone && !/^0[0-9]{9}$/.test(phone))) return fail('QP_INVALID_INPUT');
      if (phone && !a.p_phone_consent) return fail('QP_CONSENT_REQUIRED');
      const existing = db.debt_customers!.find((x) => x.id === a.p_customer_id);
      if (existing) return ok({ ...existing });
      const row = { id: a.p_customer_id, business_id: a.p_business_id, name, phone, consent_at: phone ? nowIso() : null,
        consent_source: phone ? 'app_so_no' : null, created_at: nowIso() };
      db.debt_customers!.push(row);
      return ok({ ...row });
    }

    case 'record_debt_v1': {
      const c = db.debt_customers!.find((x) => x.id === a.p_customer_id);
      if (!c || !member(c.business_id)) return fail('QP_NOT_FOUND');
      if (!['DEBT', 'PAYMENT'].includes(a.p_kind) || !(a.p_amount > 0)) return fail('QP_INVALID_INPUT');
      const existing = db.debt_entries!.find((x) => x.id === a.p_entry_id);
      if (existing) return ok({ ...existing });
      if (a.p_kind === 'PAYMENT') {
        const bal = debtBalances().find((x) => x.customer_id === c.id)?.balance ?? 0;
        if (a.p_amount > bal) return fail('QP_PAYMENT_EXCEEDS_DEBT');
      }
      const row = { id: a.p_entry_id, business_id: c.business_id, customer_id: c.id, kind: a.p_kind, amount: a.p_amount,
        note: a.p_note ? String(a.p_note).trim() || null : null, entry_date: vnDay(), created_at: nowIso(), voided_at: null };
      db.debt_entries!.push(row);
      return ok({ ...row });
    }

    case 'void_debt_entry_v1': {
      const row = db.debt_entries!.find((x) => x.id === a.p_entry_id);
      const m = row ? member(row.business_id) : undefined;
      if (!row || !m) return fail('QP_NOT_FOUND');
      if (!['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      row.voided_at = row.voided_at ?? nowIso();
      return ok({ ...row });
    }

    // ---------- Migration 7 ----------
    case 'upsert_product_v1': {
      const m = member(a.p_business_id);
      if (!m || !['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      const nm = String(a.p_name ?? '').trim();
      if (!nm || !(a.p_price >= 0) || !String(a.p_unit ?? '').trim()) return fail('QP_INVALID_INPUT');
      let p = db.products!.find((x) => x.id === a.p_product_id);
      const fields = { name: nm, price: a.p_price, unit: String(a.p_unit).trim(), category: a.p_category ? String(a.p_category).trim() || null : null,
        cost_price: a.p_cost_price ?? null, track_stock: !!a.p_track_stock, low_stock_at: a.p_low_stock_at ?? null, is_active: true };
      if (p) Object.assign(p, fields);
      else {
        p = { id: a.p_product_id, business_id: a.p_business_id, stock_qty: 0, sort_order: 0, ...fields };
        db.products!.push(p);
      }
      return ok({ ...p });
    }

    case 'upsert_product_v2': {
      const m = member(a.p_business_id);
      if (!m || !['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      const nm = String(a.p_name ?? '').trim();
      const code = a.p_barcode ? String(a.p_barcode).trim() || null : null;
      const warn = a.p_expiry_warn_days ?? 7;
      if (!nm || nm.length > 100 || !(a.p_price >= 0) || !String(a.p_unit ?? '').trim() || (code && !VALID_CODE.test(code)) || !(warn >= 1 && warn <= 365))
        return fail('QP_INVALID_INPUT');
      let p = db.products!.find((x) => x.id === a.p_product_id);
      if (p && (p.business_id !== a.p_business_id || p.archived_at)) return fail('QP_NOT_FOUND');
      if (code && db.products!.some((x) => x.business_id === a.p_business_id && x.barcode === code && !x.archived_at && x.id !== a.p_product_id))
        return fail('QP_DUPLICATE_BARCODE');
      const fields = { name: nm, price: a.p_price, unit: String(a.p_unit).trim(), category: a.p_category ? String(a.p_category).trim() || null : null,
        cost_price: a.p_cost_price ?? null, track_stock: !!a.p_track_stock || !!a.p_track_expiry, low_stock_at: a.p_low_stock_at ?? null,
        barcode: code, track_expiry: !!a.p_track_expiry, expiry_warn_days: warn };
      if (p) Object.assign(p, fields);
      else {
        p = { id: a.p_product_id, business_id: a.p_business_id, stock_qty: 0, sort_order: 0, is_active: true, archived_at: null, ...fields };
        db.products!.push(p);
      }
      return ok({ ...p });
    }

    case 'delete_product_v1': {
      const i = db.products!.findIndex((x) => x.id === a.p_product_id);
      if (i < 0) return ok('DELETED');
      const p = db.products![i]!;
      const m = member(p.business_id);
      if (!m) return fail('QP_NOT_FOUND');
      if (!['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      if (p.archived_at) return ok('ARCHIVED');
      const used = db.order_items!.some((x) => x.product_id === p.id) || db.stock_movements!.some((x) => x.product_id === p.id);
      if (!used) {
        db.products!.splice(i, 1);
        return ok('DELETED');
      }
      p.archived_at = nowIso();
      p.is_active = false;
      return ok('ARCHIVED');
    }

    case 'stock_in_v2': {
      const p = db.products!.find((x) => x.id === a.p_product_id);
      if (!p || !member(p.business_id) || p.archived_at) return fail('QP_NOT_FOUND');
      if (db.stock_movements!.some((x) => x.id === a.p_movement_id)) return ok({ ...p });
      if (p.track_expiry && !a.p_expires_on) return fail('QP_EXPIRY_REQUIRED');
      const r = rpcImpl('stock_in_v1', a);
      if (r.error) return r;
      if (a.p_expires_on || p.track_expiry) {
        db.stock_lots!.push({ id: a.p_movement_id, business_id: p.business_id, product_id: p.id, expires_on: a.p_expires_on ?? null,
          qty_in: Number(a.p_qty), qty_left: Number(a.p_qty), created_at: nowIso() });
        const mv = db.stock_movements!.find((x) => x.id === a.p_movement_id);
        if (mv) mv.lot_id = a.p_movement_id;
      }
      return ok({ ...p });
    }

    case 'stock_out_v1': {
      const p = db.products!.find((x) => x.id === a.p_product_id);
      const m = p ? member(p.business_id) : undefined;
      if (!p || !m || p.archived_at) return fail('QP_NOT_FOUND');
      if (!['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      if (db.stock_movements!.some((x) => x.id === a.p_movement_id)) return ok({ ...p });
      const q = Number(a.p_qty);
      if (!(q > 0) || !['EXPIRED', 'DAMAGED', 'USED', 'OTHER'].includes(a.p_reason)) return fail('QP_INVALID_INPUT');
      if (q > Math.max(p.stock_qty, 0)) return fail('QP_OUT_EXCEEDS_STOCK');
      if (a.p_lot_id) {
        const l = db.stock_lots!.find((x) => x.id === a.p_lot_id && x.product_id === p.id);
        if (!l) return fail('QP_NOT_FOUND');
        if (q > l.qty_left) return fail('QP_OUT_EXCEEDS_STOCK');
        l.qty_left = Math.round((l.qty_left - q) * 1000) / 1000;
      }
      db.stock_movements!.push({ id: a.p_movement_id, business_id: p.business_id, product_id: p.id, kind: 'OUT', qty: -q, unit_cost: null,
        order_id: null, note: a.p_note ?? null, reason: a.p_reason, lot_id: a.p_lot_id ?? null, created_at: nowIso() });
      p.stock_qty = Math.round((p.stock_qty - q) * 1000) / 1000;
      trimLots(p);
      return ok({ ...p });
    }

    case 'expiring_lots': {
      if (!member(a.p_business_id)) return ok([]);
      const today = vnDay();
      const rows = db.stock_lots!
        .filter((l) => l.business_id === a.p_business_id && l.qty_left > 0 && l.expires_on)
        .map((l) => {
          const p = db.products!.find((x) => x.id === l.product_id)!;
          const days = Math.round((Date.parse(`${l.expires_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
          return { p, row: { lot_id: l.id, product_id: p.id, name: p.name, unit: p.unit, expires_on: l.expires_on, qty_left: l.qty_left, days_left: days } };
        })
        .filter(({ p, row }) => p && !p.archived_at && row.days_left <= (p.expiry_warn_days ?? 7))
        .map(({ row }) => row)
        .sort((x, y) => x.expires_on.localeCompare(y.expires_on) || x.name.localeCompare(y.name));
      return ok(rows);
    }

    case 'stock_report': {
      if (!member(a.p_business_id)) return ok([]);
      const from = Date.parse(a.p_from);
      const to = Date.parse(a.p_to);
      if (!(to > from) || to - from > 400 * 86_400_000) return ok([]);
      const sum = (pid: string, f: (mv: Row) => boolean) =>
        db.stock_movements!.filter((mv) => mv.product_id === pid && f(mv)).reduce((t, mv) => t + mv.qty, 0);
      const r3 = (n: number) => Math.round(n * 1000) / 1000;
      const rows = db.products!
        .filter((p) => p.business_id === a.p_business_id)
        .map((p) => {
          const t = (mv: Row) => Date.parse(mv.created_at);
          const inPeriod = (mv: Row) => t(mv) >= from && t(mv) < to;
          const any = db.stock_movements!.some((mv) => mv.product_id === p.id && t(mv) >= from);
          if (!(p.track_stock || any) || (p.archived_at && !any)) return null;
          const closing = r3(p.stock_qty - sum(p.id, (mv) => t(mv) >= to));
          return {
            product_id: p.id, name: p.name, unit: p.unit,
            opening: r3(p.stock_qty - sum(p.id, (mv) => t(mv) >= from)),
            qty_in: r3(sum(p.id, (mv) => inPeriod(mv) && mv.kind === 'IN')),
            qty_sold: r3(-sum(p.id, (mv) => inPeriod(mv) && mv.kind === 'SALE')),
            qty_out: r3(-sum(p.id, (mv) => inPeriod(mv) && mv.kind === 'OUT')),
            qty_adjust: r3(sum(p.id, (mv) => inPeriod(mv) && mv.kind === 'COUNT')),
            closing, cost_price: p.cost_price ?? null,
            closing_value: p.cost_price == null ? null : Math.round(Math.max(closing, 0) * p.cost_price),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((x, y) => x.name.localeCompare(y.name));
      return ok(rows);
    }

    case 'set_product_active_v1': {
      const p = db.products!.find((x) => x.id === a.p_product_id);
      const m = p ? member(p.business_id) : undefined;
      if (!p || !m || p.archived_at) return fail('QP_NOT_FOUND');
      if (!['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      p.is_active = a.p_active !== false;
      return ok({ ...p });
    }

    case 'stock_in_v1':
    case 'stock_count_v1': {
      const p = db.products!.find((x) => x.id === a.p_product_id);
      const m = p ? member(p.business_id) : undefined;
      if (!p || !m) return fail('QP_NOT_FOUND');
      const count = name === 'stock_count_v1';
      if (count && !['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      const q = Number(count ? a.p_actual_qty : a.p_qty);
      if (!(count ? q >= 0 : q > 0)) return fail('QP_INVALID_INPUT');
      if (db.stock_movements!.some((x) => x.id === a.p_movement_id)) return ok({ ...p });
      const delta = count ? q - p.stock_qty : q;
      db.stock_movements!.push({ id: a.p_movement_id, business_id: p.business_id, product_id: p.id, kind: count ? 'COUNT' : 'IN', qty: delta,
        unit_cost: count ? null : a.p_unit_cost ?? null, order_id: null, note: a.p_note ?? null, created_at: nowIso() });
      p.stock_qty = count ? q : Math.round((p.stock_qty + q) * 1000) / 1000;
      p.track_stock = true;
      if (count) trimLots(p);
      if (!count && a.p_unit_cost != null) {
        p.cost_price = a.p_unit_cost;
        if (a.p_record_expense) {
          db.journal_entries!.push({ id: uid(), business_id: p.business_id, entry_type: 'EXPENSE', amount: Math.round(q * a.p_unit_cost), category: 'Nhập hàng',
            description: `Nhập ${q} ${p.unit} ${p.name}`, source: 'MANUAL', source_id: a.p_movement_id, entry_date: vnDay(), created_at: nowIso(), voided_at: null });
        }
      }
      return ok({ ...p });
    }

    case 'sales_by_hour': {
      const map = new Map<number, Row>();
      for (const o of paidOrdersBetween(a.p_business_id, a.p_from, a.p_to)) {
        const h = new Date(Date.parse(o.sold_at) + 7 * 3_600_000).getUTCHours();
        const r = map.get(h) ?? { hour: h, orders: 0, amount: 0 };
        r.orders += 1;
        r.amount += o.total_amount;
        map.set(h, r);
      }
      return ok([...map.values()].sort((x, y) => x.hour - y.hour));
    }

    case 'top_products': {
      const ids = new Set(paidOrdersBetween(a.p_business_id, a.p_from, a.p_to).map((o) => o.id));
      const map = new Map<string, Row>();
      for (const it of db.order_items!) {
        if (!it.product_id || !ids.has(it.order_id)) continue;
        const r = map.get(it.product_id) ?? { product_id: it.product_id, name: it.name, quantity: 0, amount: 0 };
        r.quantity += it.quantity;
        r.amount += it.line_amount;
        map.set(it.product_id, r);
      }
      return ok([...map.values()].sort((x, y) => y.amount - x.amount).slice(0, a.p_limit ?? 10));
    }

    case 'open_shift_v1': {
      if (!member(a.p_business_id)) return fail('QP_FORBIDDEN');
      if (!(a.p_opening_cash >= 0)) return fail('QP_INVALID_INPUT');
      const open = db.cash_shifts!.find((x) => x.business_id === a.p_business_id && !x.closed_at);
      if (open) return ok({ ...open });
      const row = { id: a.p_shift_id, business_id: a.p_business_id, opened_at: nowIso(), opening_cash: a.p_opening_cash, closed_at: null,
        cash_sales: null, cash_expenses: null, expected_cash: null, counted_cash: null, note: null };
      db.cash_shifts!.push(row);
      return ok({ ...row });
    }

    case 'current_shift_v1':
    case 'close_shift_v1': {
      const shift = name === 'current_shift_v1'
        ? db.cash_shifts!.find((x) => x.business_id === a.p_business_id && !x.closed_at)
        : db.cash_shifts!.find((x) => x.id === a.p_shift_id);
      if (!shift) return name === 'current_shift_v1' ? ok([]) : fail('QP_NOT_FOUND');
      if (shift.closed_at) return ok({ ...shift });
      const now = nowIso();
      const cash = db.orders!.filter((o) => o.business_id === shift.business_id && o.payment_method === 'CASH' && o.payment_status === 'PAID' && o.sold_at >= shift.opened_at && o.sold_at <= now);
      const sales = cash.reduce((t, o) => t + o.total_amount, 0);
      const spent = db.journal_entries!.filter((j) => j.business_id === shift.business_id && j.entry_type === 'EXPENSE' && !j.voided_at && j.created_at >= shift.opened_at)
        .reduce((t, j) => t + j.amount, 0);
      const expected = shift.opening_cash + sales - spent;
      if (name === 'current_shift_v1') {
        return ok([{ shift_id: shift.id, opened_at: shift.opened_at, opening_cash: shift.opening_cash, cash_sales: sales, cash_orders: cash.length, cash_expenses: spent, expected_cash: expected }]);
      }
      if (!(a.p_counted_cash >= 0)) return fail('QP_INVALID_INPUT');
      Object.assign(shift, { closed_at: now, cash_sales: sales, cash_expenses: spent, expected_cash: expected, counted_cash: a.p_counted_cash, note: a.p_note ?? null });
      return ok({ ...shift });
    }

    case 'invite_member_v1': {
      const m = member(a.p_business_id);
      if (!m || m.role !== 'OWNER') return fail('QP_FORBIDDEN');
      const digits = String(a.p_phone ?? '').replace(/\D/g, '');
      if (!/^0[0-9]{9}$/.test(digits) || !['MANAGER', 'CASHIER', 'ACCOUNTANT'].includes(a.p_role)) return fail('QP_INVALID_INPUT');
      const phone = `84${digits.slice(1)}`;
      if (db.business_members!.some((x) => x.business_id === a.p_business_id && x.member_phone === digits)) return fail('QP_ALREADY_MEMBER');
      if (user && user.phone.replace(/\D/g, '') === phone) return fail('QP_ALREADY_MEMBER');
      const open = db.business_invites!.find((x) => x.business_id === a.p_business_id && x.phone === phone && !x.accepted_at && !x.revoked_at);
      if (open) {
        open.role = a.p_role;
        return ok({ ...open });
      }
      const row = { id: a.p_invite_id, business_id: a.p_business_id, phone, role: a.p_role, created_at: nowIso(), accepted_at: null, revoked_at: null };
      db.business_invites!.push(row);
      return ok({ ...row });
    }

    case 'revoke_invite_v1': {
      const iv = db.business_invites!.find((x) => x.id === a.p_invite_id);
      if (!iv || member(iv.business_id)?.role !== 'OWNER') return fail('QP_NOT_FOUND');
      if (!iv.accepted_at) iv.revoked_at = iv.revoked_at ?? nowIso();
      return ok({ ...iv });
    }

    case 'accept_invites_v1': {
      if (!user) return fail('QP_UNAUTHENTICATED');
      const phone = user.phone.replace(/\D/g, '');
      let n = 0;
      for (const iv of db.business_invites!.filter((x) => x.phone === phone && !x.accepted_at && !x.revoked_at)) {
        if (!member(iv.business_id)) db.business_members!.push({ business_id: iv.business_id, user_id: user.id, role: iv.role, member_phone: `0${phone.slice(2)}`, created_at: nowIso() });
        iv.accepted_at = nowIso();
        n++;
      }
      return ok(n);
    }

    case 'set_member_role_v1':
    case 'remove_member_v1': {
      if (member(a.p_business_id)?.role !== 'OWNER') return fail('QP_FORBIDDEN');
      const idx = db.business_members!.findIndex((x) => x.business_id === a.p_business_id && x.user_id === a.p_user_id && x.role !== 'OWNER');
      if (idx < 0) return fail('QP_NOT_FOUND');
      if (name === 'remove_member_v1') db.business_members!.splice(idx, 1);
      else db.business_members![idx]!.role = a.p_role;
      return ok(null);
    }

    case 'upsert_customer_v1': {
      if (!member(a.p_business_id)) return fail('QP_FORBIDDEN');
      const nm = String(a.p_name ?? '').trim();
      const phone = a.p_phone ? String(a.p_phone).replace(/\D/g, '') : null;
      if (!nm || (phone && !/^0[0-9]{9}$/.test(phone))) return fail('QP_INVALID_INPUT');
      if (phone && !a.p_consent) return fail('QP_CONSENT_REQUIRED');
      if (phone && db.crm_customers!.some((x) => x.business_id === a.p_business_id && x.phone_number === phone && x.id !== a.p_customer_id)) return fail('QP_PHONE_TAKEN');
      let c = db.crm_customers!.find((x) => x.id === a.p_customer_id);
      if (c) Object.assign(c, { display_name: nm, phone_number: phone });
      else {
        c = { id: a.p_customer_id, business_id: a.p_business_id, display_name: nm, phone_number: phone, consent_at: phone ? nowIso() : null,
          consent_source: phone ? 'app_khach_quen' : null, points: 0, total_spent: 0, visits: 0, last_visit_at: null, created_at: nowIso() };
        db.crm_customers!.push(c);
      }
      return ok({ ...c });
    }

    case 'set_order_customer_v1': {
      const o = findOrder(a.p_order_id);
      if (!o || !member(o.business_id) || !db.crm_customers!.some((c) => c.id === a.p_customer_id && c.business_id === o.business_id)) return fail('QP_NOT_FOUND');
      if (o.customer_id && o.customer_id !== a.p_customer_id) return fail('QP_ALREADY_ASSIGNED');
      if (!o.customer_id) {
        o.customer_id = a.p_customer_id;
        awardPoints(o);
      }
      return ok({ ...o });
    }

    case 'redeem_points_v1': {
      const c = db.crm_customers!.find((x) => x.id === a.p_customer_id);
      if (!c || !member(c.business_id)) return fail('QP_NOT_FOUND');
      if (!(a.p_points > 0)) return fail('QP_INVALID_INPUT');
      if (db.loyalty_events!.some((e) => e.id === a.p_event_id)) return ok({ ...c });
      if (a.p_points > c.points) return fail('QP_NOT_ENOUGH_POINTS');
      db.loyalty_events!.push({ id: a.p_event_id, business_id: c.business_id, customer_id: c.id, order_id: null, kind: 'REDEEM', points: a.p_points, note: a.p_note ?? null, created_at: nowIso() });
      c.points -= a.p_points;
      return ok({ ...c });
    }

    case 'update_loyalty_settings_v1':
    case 'update_invoice_settings_v1': {
      const m = member(a.p_business_id);
      if (!m || !['OWNER', 'MANAGER'].includes(m.role)) return fail('QP_FORBIDDEN');
      const b = db.businesses!.find((x) => x.id === a.p_business_id)!;
      if (name === 'update_loyalty_settings_v1') {
        if (!(a.p_vnd_per_point >= 0)) return fail('QP_INVALID_INPUT');
        b.loyalty_vnd_per_point = a.p_vnd_per_point;
      } else {
        const sym = String(a.p_symbol ?? '').toUpperCase();
        if (a.p_provider !== 'NONE' && !/^[A-Z0-9]{6}$/.test(sym)) return fail('QP_INVALID_INPUT');
        Object.assign(b, { einvoice_provider: a.p_provider, invoice_form_no: a.p_form_no, invoice_symbol: sym || null });
      }
      return ok({ ...b });
    }

    case 'create_debt_payment_order_v1': {
      const c = db.debt_customers!.find((x) => x.id === a.p_customer_id);
      if (!c || !member(c.business_id)) return fail('QP_NOT_FOUND');
      const existing = findOrder(a.p_order_id);
      if (existing) return ok({ ...existing });
      if (!(a.p_amount > 0)) return fail('QP_INVALID_INPUT');
      if (a.p_amount > debtBalanceOf(c.id)) return fail('QP_PAYMENT_EXCEEDS_DEBT');
      const r = rpcImpl('create_order_v1', { p_order_id: a.p_order_id, p_business_id: c.business_id, p_items: [{ name: 'Trả nợ', quantity: 1, unit_price: a.p_amount }], p_device_id: a.p_device_id });
      if (r.error) return r;
      const o = findOrder(a.p_order_id)!;
      o.debt_customer_id = c.id;
      return ok({ ...o });
    }

    case 'create_invoice_from_order_v1': {
      const o = findOrder(a.p_order_id);
      if (!o || !member(o.business_id)) return fail('QP_NOT_FOUND');
      if (o.payment_status !== 'PAID') return fail('QP_ORDER_NOT_PAID');
      const b = db.businesses!.find((x) => x.id === o.business_id)!;
      if (b.einvoice_provider === 'NONE' || !b.invoice_symbol) return fail('QP_EINVOICE_NOT_SETUP');
      if (a.p_buyer_tax_code && !/^[0-9]{10}([0-9]{2}|-[0-9]{3})?$/.test(a.p_buyer_tax_code)) return fail('QP_INVALID_INPUT');
      const existing = db.invoices!.find((x) => x.order_id === o.id);
      if (existing) return ok({ ...existing });
      const inv = { id: a.p_invoice_id, business_id: o.business_id, order_id: o.id, form_no: b.invoice_form_no, symbol: b.invoice_symbol, invoice_no: null,
        status: 'DRAFT', buyer_name: a.p_buyer_name || null, buyer_tax_code: a.p_buyer_tax_code || null, buyer_email: a.p_buyer_email || null,
        total_amount: 0, issued_at: null, tax_authority_code: null, lookup_url: null, created_at: nowIso() };
      db.invoices!.push(inv);
      return ok({ ...inv });
    }

    default:
      return fail(`demo: chưa giả lập ${name}`);
  }
}

class RpcCall implements PromiseLike<Result> {
  constructor(private name: string, private args: Row) {}
  abortSignal() { return this; }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return new Promise<Result>((r) =>
      setTimeout(() => {
        const res = rpcImpl(this.name, this.args);
        if (!res.error) persistNow();
        r(res);
      }, 250),
    ).then(ok, no);
  }
}

// ---------------- Client giả lập ----------------
export function createDemoClient() {
  return {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Row = {}) => new RpcCall(name, args),
    auth: {
      async signInWithOtp({ phone }: { phone: string }) {
        return { data: {}, error: null, phone };
      },
      async verifyOtp({ phone, token }: { phone: string; token: string }) {
        if (!/^[0-9]{6}$/.test(token)) return { data: { user: null }, error: { message: 'Mã sai' } };
        user = { id: 'demo-user-' + phone.replace(/\D/g, ''), phone };
        persistNow(true);
        for (const l of authListeners) l('SIGNED_IN', session());
        return { data: { user: session()!.user, session: session() }, error: null };
      },
      async getSession() {
        return { data: { session: session() }, error: null };
      },
      async getUser() {
        return { data: { user: session()?.user ?? null }, error: null };
      },
      async signOut() {
        // Đăng xuất chỉ bỏ phiên: dữ liệu quán vẫn nằm trên máy, đăng nhập lại cùng số điện thoại là thấy lại
        user = null;
        persistNow(true);
        for (const l of authListeners) l('SIGNED_OUT', null);
        return { error: null };
      },
      onAuthStateChange(cb: (event: string, s: unknown) => void) {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      startAutoRefresh() {},
      stopAutoRefresh() {},
    },
    functions: {
      async invoke(name: string, opts: { body: Record<string, string> }) {
        if (name === 'issue-einvoice') {
          const inv = db.invoices!.find((x) => x.id === opts.body.invoice_id);
          if (!inv) return { data: null, error: { message: 'QP_NOT_FOUND' } };
          if (inv.status === 'DRAFT') {
            const b = db.businesses!.find((x) => x.id === inv.business_id)!;
            if (b.einvoice_provider !== 'DEMO') return { data: null, error: { message: 'QP_EINVOICE_PROVIDER_NOT_READY' } };
            const year = Number(vnDay().slice(0, 4));
            const no = db.invoices!.filter((x) => x.business_id === inv.business_id && x.symbol === inv.symbol && x.invoice_no).length + 1;
            const total = orderItems(inv.order_id).reduce((t, i) => t + i.line_amount, 0);
            Object.assign(inv, { status: 'ISSUED', invoice_no: no, issued_at: nowIso(), total_amount: total,
              tax_authority_code: `M1-${String(year % 100).padStart(2, '0')}-DEMO0-${String(no).padStart(11, '0')}` });
          }
          return { data: { ...inv }, error: null };
        }
        if (name !== 'qr-for-order') return { data: null, error: { message: `demo: chưa giả lập ${name}` } };
        const o = findOrder(String(opts.body.order_id));
        if (!o) return { data: null, error: { message: 'QP_NOT_FOUND' } };
        const amount = o.total_amount - o.amount_received;
        const acc = db.payment_accounts!.find((x) => x.business_id === o.business_id && x.is_active && x.kind === 'MAIN');
        if (!acc) return { data: null, error: { message: 'QP_NO_PAYMENT_ACCOUNT' } };
        const biz = db.businesses!.find((x) => x.id === o.business_id);
        return {
          data: {
            qr_payload: buildVietQr({ bankBin: acc.bank_bin, accountNo: acc.account_no, amount, content: o.order_code }),
            bank_name: acc.provider === 'DEMO' ? 'MB Bank (dùng thử)' : bankDisplayName(acc.bank_bin),
            account_name: biz?.bank_account_name ?? '', amount,
            uses_order_code: true, order_code: o.order_code, expires_at: null,
          },
          error: null,
        };
      },
    },
    channel(_name: string) {
      const handlers: ((p: { new: Row }) => void)[] = [];
      const ch = {
        on(_type: string, _filter: unknown, cb: (p: { new: Row }) => void) {
          handlers.push(cb);
          return ch;
        },
        subscribe(cb?: (status: string) => void) {
          for (const h of handlers) orderListeners.add(h);
          setTimeout(() => cb?.('SUBSCRIBED'), 0);
          return ch;
        },
        _off() {
          for (const h of handlers) orderListeners.delete(h);
        },
      };
      return ch;
    },
    async removeChannel(ch: { _off: () => void }) {
      ch._off();
      return 'ok';
    },
  };
}

/** Cho test: tổng tiền đã thu của một quán. */
export function demoPaidTotal(bizId: string): number {
  return paidRowsFor(bizId).reduce((s, o) => s + o.total_amount, 0);
}
