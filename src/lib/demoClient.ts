/**
 * Chế độ DÙNG THỬ: giả lập Supabase trong bộ nhớ máy khi bản build chưa có địa chỉ máy chủ.
 * Chỉ cài đặt đúng những lời gọi app đang dùng (docs/api.md). Không dùng cho bản thật:
 * supabase.ts chỉ chọn client này khi thiếu EXPO_PUBLIC_SUPABASE_URL / ANON_KEY.
 * Có giả lập "khách chuyển khoản" 12 giây sau khi hiện mã QR để xem màn hình báo tiền.
 */
import { buildVietQr } from '../../supabase/functions/_shared/vietqr';
import { vnDay } from './time';

type Row = Record<string, any>;
type Result = { data: any; error: { message: string } | null; count?: number };

const DEMO_BIN = '970422';
const DEMO_ACCOUNT = '0903456789';
// Bản kiểm thử tự động đặt dài hơn để kịp thử "xác nhận tay" và "hủy đơn" trước khi khách "chuyển"
const CUSTOMER_PAYS_AFTER_MS = Number(process.env.EXPO_PUBLIC_DEMO_PAY_MS ?? 12000) || 12000;

const uid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const orderCode = () => Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const nowIso = () => new Date().toISOString();

// ---------------- Dữ liệu trong bộ nhớ ----------------
const db: Record<string, Row[]> = {
  businesses: [],
  business_members: [],
  payment_accounts: [],
  orders: [],
  payment_events: [],
  user_consents: [],
};
let user: { id: string; phone: string } | null = null;
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

function updateOrder(o: Row, patch: Row) {
  Object.assign(o, patch, { updated_at: nowIso() });
  o.overpaid_amount = Math.max(o.amount_received - o.total_amount, 0);
  emitOrder(o);
}

/** Dữ liệu mẫu cho quán mới tạo: tài khoản nhận tiền, vài đơn hôm nay, một khoản tiền chưa rõ đơn. */
function seedBusiness(bizId: string) {
  db.payment_accounts!.push({ id: uid(), business_id: bizId, provider: 'DEMO', bank_bin: DEMO_BIN, account_no: DEMO_ACCOUNT, kind: 'MAIN', label: null, is_active: true });
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
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
}

function paidRowsFor(bizId: string) {
  return db.orders!.filter((o) => o.business_id === bizId && o.payment_status === 'PAID');
}

function dailySales(): Row[] {
  const map = new Map<string, Row>();
  for (const o of db.orders!) {
    if (o.payment_status !== 'PAID') continue;
    const day = vnDay(new Date(o.sold_at));
    const k = `${o.business_id}|${day}|${o.payment_method}`;
    const r = map.get(k) ?? { business_id: o.business_id, sale_date: day, method: o.payment_method, orders_count: 0, amount: 0 };
    r.orders_count += 1;
    r.amount += o.total_amount;
    map.set(k, r);
  }
  return [...map.values()];
}

function tableRows(table: string): Row[] {
  if (table === 'daily_sales') return dailySales();
  if (table === 'unreconciled_manual_confirmations') {
    const cutoff = Date.now() - 15 * 60_000;
    return db.orders!.filter((o) => o.manual_confirmed_at && o.amount_received < o.total_amount && Date.parse(o.manual_confirmed_at) < cutoff);
  }
  return db[table] ?? [];
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
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: string | number) { this.filters.push((r) => r[c] >= v); return this; }
  lte(c: string, v: string | number) { this.filters.push((r) => r[c] <= v); return this; }
  lt(c: string, v: string | number) { this.filters.push((r) => r[c] < v); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.sort = { col, asc: o?.ascending ?? true }; return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  abortSignal() { return this; }

  private run(): Result {
    let rows = tableRows(this.table).filter((r) => this.filters.every((f) => f(r)));
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
        address: String(a.p_address).trim(), allow_cashier_manual_confirm: true, bank_account_name: 'NGUYEN THI BA',
      };
      db.businesses!.push(b);
      db.business_members!.push({ business_id: b.id, user_id: user!.id, role: 'OWNER', created_at: nowIso() });
      seedBusiness(b.id);
      return ok(b);
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
      const existing = db.orders!.find((o) => o.id === a.p_order_id);
      if (existing) return ok(existing);
      const items = (a.p_items ?? []) as Row[];
      if (items.length === 0) return fail('QP_INVALID_ITEMS');
      const cash = name === 'create_cash_sale_v1';
      const o = newOrder(a.p_business_id, items, cash ? 'CASH' : 'VIETQR', a.p_device_id ?? null, a.p_sold_at);
      o.id = a.p_order_id;
      if (cash) Object.assign(o, { payment_status: 'PAID', amount_received: o.total_amount, paid_at: nowIso() });
      else if (o.total_amount <= 0) return fail('QP_INVALID_ITEMS');
      db.orders!.push(o);
      if (!cash) {
        // Giả lập khách quét mã và chuyển đủ tiền
        setTimeout(() => {
          if (o.payment_status === 'UNPAID' && o.amount_received === 0) {
            updateOrder(o, { amount_received: o.total_amount, payment_status: 'PAID', paid_at: nowIso() });
          }
        }, CUSTOMER_PAYS_AFTER_MS);
      }
      return ok({ ...o });
    }

    case 'cancel_order_v1': {
      const o = db.orders!.find((x) => x.id === a.p_order_id);
      if (!o) return fail('QP_NOT_FOUND');
      if (o.payment_status === 'CANCELLED') return ok({ ...o });
      if (o.payment_status !== 'UNPAID' || o.amount_received > 0) return fail('QP_ORDER_NOT_CANCELLABLE');
      updateOrder(o, { payment_status: 'CANCELLED' });
      return ok({ ...o });
    }

    case 'confirm_transfer_manually_v1': {
      const o = db.orders!.find((x) => x.id === a.p_order_id);
      if (!o) return fail('QP_NOT_FOUND');
      if (o.payment_status === 'PAID') return ok({ ...o });
      if (o.payment_status !== 'UNPAID') return fail('QP_ORDER_NOT_CONFIRMABLE');
      updateOrder(o, { payment_status: 'PAID', paid_at: nowIso(), manual_confirmed_by: user?.id, manual_confirmed_at: nowIso(), manual_note: a.p_note ?? null });
      return ok({ ...o });
    }

    case 'assign_payment_event_v1': {
      const ev = db.payment_events!.find((x) => x.id === a.p_event_id);
      const o = db.orders!.find((x) => x.id === a.p_order_id);
      if (!ev || !o || ev.business_id !== o.business_id) return fail('QP_NOT_FOUND');
      if (ev.match_status !== 'UNMATCHED') return fail('QP_ALREADY_ASSIGNED');
      const received = o.amount_received + ev.amount;
      const status = received >= o.total_amount ? (received === o.total_amount ? 'MATCHED' : 'OVERPAID') : 'PARTIAL';
      updateOrder(o, received >= o.total_amount ? { amount_received: received, payment_status: 'PAID', paid_at: nowIso() } : { amount_received: received });
      Object.assign(ev, { order_id: o.id, match_status: status });
      return ok(status);
    }

    case 'day_summary': {
      return ok(dailySales().filter((r) => r.business_id === a.p_business_id && r.sale_date === a.p_day));
    }

    case 'list_orders': {
      const afterSold = a.p_after_sold_at ?? '9999';
      const afterId = a.p_after_id ?? 'ffffffff';
      const rows = db.orders!
        .filter((o) => o.business_id === a.p_business_id && o.sold_at >= a.p_from && o.sold_at < a.p_to)
        .filter((o) => o.sold_at < afterSold || (o.sold_at === afterSold && o.id < afterId))
        .sort((x, y) => (x.sold_at === y.sold_at ? (x.id < y.id ? 1 : -1) : x.sold_at < y.sold_at ? 1 : -1))
        .slice(0, Math.min(a.p_limit ?? 20, 100));
      return ok(rows.map((r) => ({ ...r })));
    }

    default:
      return fail(`demo: chưa giả lập ${name}`);
  }
}

class RpcCall implements PromiseLike<Result> {
  constructor(private name: string, private args: Row) {}
  abortSignal() { return this; }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return new Promise<Result>((r) => setTimeout(() => r(rpcImpl(this.name, this.args)), 250)).then(ok, no);
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
        user = null;
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
      async invoke(name: string, opts: { body: { order_id: string } }) {
        if (name !== 'qr-for-order') return { data: null, error: { message: `demo: chưa giả lập ${name}` } };
        const o = db.orders!.find((x) => x.id === opts.body.order_id);
        if (!o) return { data: null, error: { message: 'QP_NOT_FOUND' } };
        const amount = o.total_amount - o.amount_received;
        return {
          data: {
            qr_payload: buildVietQr({ bankBin: DEMO_BIN, accountNo: DEMO_ACCOUNT, amount, content: o.order_code }),
            bank_name: 'MB Bank (dùng thử)', account_name: 'NGUYEN THI BA', amount,
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
