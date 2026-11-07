/**
 * Máy nhân viên (gói Pro): ghép máy với máy chủ quán, gửi lệnh, nhận tin đẩy; tự nối lại và dò lại máy chủ quán
 * khi IP đổi. Không phụ thuộc thư viện mạng (TCP gắn ở tcp.ts).
 */
import {
  open, randomKey, seal, type LanRequest, type LanResult, type LineConn, type PairingQr, type StaffPairing,
} from './protocol';

export type Connect = (host: string, port: number, timeoutMs: number) => Promise<LineConn>;
/** Dò máy chủ quán trong mạng con của máy này; trả IP hoặc null */
export type Scan = (port: number, hostId: string) => Promise<string | null>;

const REQUEST_TIMEOUT_MS = 10_000;
const NETWORK_ERROR = 'Network request failed: không nối được máy chủ quán';

/** Ghép máy bằng mã QR của máy chủ quán. */
export async function pairWithHost(connect: Connect, qr: PairingQr, deviceId: string, staffName: string): Promise<StaffPairing> {
  const conn = await connect(qr.h, qr.p, 5000);
  const key = randomKey();
  return new Promise<StaffPairing>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.close();
      reject(new Error(NETWORK_ERROR));
    }, REQUEST_TIMEOUT_MS);
    conn.onLine((line) => {
      let m: { t?: string; code?: string; n?: string; c?: string };
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.t === 'pair-err') {
        clearTimeout(timer);
        conn.close();
        reject(new Error(m.code ?? 'QP_PAIRING_EXPIRED'));
      }
      if (m.t === 'paired' && m.n && m.c) {
        const body = open<Omit<StaffPairing, 'hostIp' | 'port' | 'deviceId' | 'key'>>(m.n, m.c, key);
        clearTimeout(timer);
        conn.close();
        if (!body || body.hostId !== qr.i) return reject(new Error('QP_PAIRING_EXPIRED'));
        resolve({ ...body, hostIp: qr.h, port: qr.p, deviceId, key });
      }
    });
    conn.send(JSON.stringify({ t: 'pair', d: deviceId, ...seal({ key, name: staffName }, qr.k) }));
  });
}

type Waiter = { resolve: (r: LanResult) => void; timer: ReturnType<typeof setTimeout> };

export class LanClient {
  private conn: LineConn | null = null;
  private connecting: Promise<LineConn> | null = null;
  private waiters = new Map<string, Waiter>();
  private pushHandlers = new Set<(row: Record<string, unknown>) => void>();
  private statusHandlers = new Set<(s: 'online' | 'offline' | 'unpaired') => void>();
  private counter = 0;
  /** Số thứ tự tăng dần kể cả khi tắt mở app: theo đồng hồ + bộ đếm */
  private lastSeq = 0;

  /** Dò cả mạng tốn pin và mạng: tối đa 2 phút một lần */
  private lastScanAt = 0;
  /** Số lần nối lại liên tiếp thất bại (giãn dần 3 → 6 → 12 … tối đa 60 giây) */
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private pairing: StaffPairing,
    private connect: Connect,
    private scan: Scan,
    private onHostMoved?: (ip: string) => void,
    /** App đang mở trên màn hình (vào nền thì không nối lại / không dò mạng) */
    private isActive: () => boolean = () => true,
  ) {}

  get info(): StaffPairing {
    return this.pairing;
  }

  onPush(cb: (row: Record<string, unknown>) => void): () => void {
    this.pushHandlers.add(cb);
    return () => {
      this.pushHandlers.delete(cb);
    };
  }

  onStatus(cb: (s: 'online' | 'offline' | 'unpaired') => void): () => void {
    this.statusHandlers.add(cb);
    return () => {
      this.statusHandlers.delete(cb);
    };
  }

  private emit(s: 'online' | 'offline' | 'unpaired') {
    for (const h of this.statusHandlers) h(s);
  }

  private nextSeq(): number {
    this.lastSeq = Math.max(this.lastSeq + 1, Date.now() * 1000);
    return this.lastSeq;
  }

  private async ensure(): Promise<LineConn> {
    if (this.conn) return this.conn;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      let conn: LineConn;
      try {
        conn = await this.connect(this.pairing.hostIp, this.pairing.port, 3000);
      } catch {
        // IP của máy chủ quán đổi (router cấp lại): dò trong mạng theo mã nhận diện (thưa thôi để đỡ hao pin)
        if (Date.now() - this.lastScanAt < 120_000) throw new Error(NETWORK_ERROR);
        this.lastScanAt = Date.now();
        const ip = await this.scan(this.pairing.port, this.pairing.hostId);
        if (!ip) throw new Error(NETWORK_ERROR);
        this.pairing = { ...this.pairing, hostIp: ip };
        this.onHostMoved?.(ip);
        conn = await this.connect(ip, this.pairing.port, 3000);
      }
      conn.onLine((line) => this.receive(line));
      conn.onClose(() => {
        if (this.conn === conn) this.conn = null;
        for (const [, w] of this.waiters) {
          clearTimeout(w.timer);
          w.resolve({ data: null, error: { message: NETWORK_ERROR } });
        }
        this.waiters.clear();
        this.emit('offline');
        // Đang có màn hình chờ tin (đơn chờ tiền): nối lại, giãn dần
        this.scheduleRetry();
      });
      this.conn = conn;
      this.failures = 0;
      this.emit('online');
      return conn;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private receive(line: string) {
    let m: { t?: string; n?: string; c?: string };
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.t === 'unpaired') {
      // Chủ quán đã thu hồi máy này: báo ngay thay vì chờ hết giờ
      for (const [, w] of this.waiters) {
        clearTimeout(w.timer);
        w.resolve({ data: null, error: { message: 'QP_PAIRING_EXPIRED' } });
      }
      this.waiters.clear();
      this.emit('unpaired');
      return;
    }
    if (!m.n || !m.c) return;
    const body = open<{ id?: string; kind?: string; row?: Record<string, unknown> } & LanResult>(m.n, m.c, this.pairing.key);
    if (!body) return;
    if (m.t === 'res' && body.id) {
      const w = this.waiters.get(body.id);
      if (!w) return;
      clearTimeout(w.timer);
      this.waiters.delete(body.id);
      w.resolve({ data: body.data ?? null, error: body.error ?? null, count: body.count });
    }
    if (m.t === 'push' && body.kind === 'order' && body.row) for (const h of this.pushHandlers) h(body.row);
  }

  /** Gửi một lệnh; mất kết nối → lỗi mạng (app xử lý như mất mạng: tiền mặt vào hàng đợi). */
  async request(req: LanRequest): Promise<LanResult> {
    let conn: LineConn;
    try {
      conn = await this.ensure();
    } catch {
      return { data: null, error: { message: NETWORK_ERROR } };
    }
    const id = `${Date.now().toString(36)}-${(this.counter++).toString(36)}`;
    return new Promise<LanResult>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        resolve({ data: null, error: { message: NETWORK_ERROR } });
      }, REQUEST_TIMEOUT_MS);
      this.waiters.set(id, { resolve, timer });
      conn.send(JSON.stringify({ t: 'req', d: this.pairing.deviceId, ...seal({ id, seq: this.nextSeq(), req }, this.pairing.key) }));
    });
  }

  /** Nối sẵn để nhận tin đẩy (gọi khi mở app) */
  warmUp() {
    if (this.closed || !this.isActive()) return;
    void this.ensure().catch(() => {
      this.failures++;
      this.emit('offline');
      this.scheduleRetry();
    });
  }

  private scheduleRetry() {
    if (this.closed || this.retryTimer || this.pushHandlers.size === 0 || !this.isActive()) return;
    const delay = Math.min(60_000, 3000 * 2 ** Math.min(this.failures, 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.warmUp();
    }, delay);
  }

  private closed = false;

  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.conn?.close();
    this.conn = null;
  }
}
