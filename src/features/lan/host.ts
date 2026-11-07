/**
 * Máy chủ quán (gói Pro): nhận lệnh của máy nhân viên, chạy trên bộ máy dữ liệu của máy này, trả kết quả,
 * đẩy tin đơn đổi trạng thái cho mọi máy. Không phụ thuộc thư viện mạng (TCP gắn ở tcp.ts).
 */
import {
  PAIRING_TTL_MS, PROTOCOL_VERSION, open, randomKey, seal,
  type LanRequest, type LanResult, type LanRole, type LineConn,
} from './protocol';

export interface LanDevice {
  deviceId: string;
  name: string;
  role: LanRole;
  /** Khóa riêng của máy (chỉ máy chủ quán và máy đó biết) */
  key: string;
  userId: string;
  pairedAt: string;
  lastSeenAt: string | null;
  /** Số thứ tự lớn nhất đã nhận (chặn gửi lại tin cũ) */
  seq: number;
}

export interface HostDeps {
  hostId: string;
  shop: () => { businessId: string; name: string } | null;
  /** Gói Pro còn dùng được không (dùng thử / đã mua) */
  planActive: () => boolean;
  loadDevices: () => LanDevice[];
  saveDevices: (d: LanDevice[]) => void;
  /** Thêm máy nhân viên làm thành viên của quán trong bộ máy dữ liệu */
  addMember: (businessId: string, userId: string, role: LanRole, name: string) => void;
  removeMember: (businessId: string, userId: string) => void;
  /** Chạy một lệnh như người dùng userId */
  execute: (userId: string, req: LanRequest) => Promise<LanResult>;
  now?: () => number;
}

interface Pending {
  key: string;
  role: LanRole;
  name: string;
  expiresAt: number;
}

export class LanHost {
  private devices: LanDevice[];
  private pending: Pending | null = null;
  private live = new Map<string, Set<LineConn>>();
  private listeners = new Set<() => void>();
  constructor(private d: HostDeps) {
    this.devices = d.loadDevices();
  }

  private now() {
    return this.d.now ? this.d.now() : Date.now();
  }

  /** Mở ghép máy: trả khóa ghép (cho vào mã QR) */
  startPairing(role: LanRole, name: string): { key: string; expiresAt: number } {
    this.pending = { key: randomKey(), role, name: name.trim().slice(0, 40) || 'Máy nhân viên', expiresAt: this.now() + PAIRING_TTL_MS };
    return { key: this.pending.key, expiresAt: this.pending.expiresAt };
  }

  cancelPairing() {
    this.pending = null;
  }

  list(): (LanDevice & { online: boolean })[] {
    return this.devices.map((x) => ({ ...x, online: (this.live.get(x.deviceId)?.size ?? 0) > 0 }));
  }

  /** Thu hồi máy: ngắt kết nối, xóa khỏi danh sách và khỏi thành viên quán */
  revoke(deviceId: string) {
    const dev = this.devices.find((x) => x.deviceId === deviceId);
    if (!dev) return;
    this.devices = this.devices.filter((x) => x.deviceId !== deviceId);
    this.d.saveDevices(this.devices);
    const shop = this.d.shop();
    if (shop) this.d.removeMember(shop.businessId, dev.userId);
    for (const c of this.live.get(deviceId) ?? []) c.close();
    this.live.delete(deviceId);
    this.changed();
  }

  /** Báo cho màn hình khi danh sách / trạng thái máy đổi */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  /** Đẩy tin đơn đổi trạng thái cho mọi máy nhân viên đang nối */
  broadcastOrder(row: unknown) {
    for (const dev of this.devices) {
      for (const c of this.live.get(dev.deviceId) ?? []) c.send(JSON.stringify({ t: 'push', ...seal({ kind: 'order', row }, dev.key) }));
    }
  }

  connectedCount(): number {
    let n = 0;
    for (const s of this.live.values()) if (s.size > 0) n++;
    return n;
  }

  /** Gắn một kết nối mới (từ máy chủ TCP) */
  attach(conn: LineConn) {
    let deviceId: string | null = null;
    conn.onClose(() => {
      if (deviceId) {
        this.live.get(deviceId)?.delete(conn);
        this.changed();
      }
    });
    conn.onLine((line) => {
      void this.handle(conn, line, (id) => {
        if (deviceId === id) return;
        deviceId = id;
        if (!this.live.has(id)) this.live.set(id, new Set());
        this.live.get(id)!.add(conn);
        this.changed();
      });
    });
  }

  private async handle(conn: LineConn, line: string, bind: (deviceId: string) => void) {
    let msg: { t?: string; d?: string; n?: string; c?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const shop = this.d.shop();

    // Dò máy chủ quán trong mạng (không lộ dữ liệu, chỉ mã nhận diện)
    if (msg.t === 'hello') {
      conn.send(JSON.stringify({ t: 'hello', hostId: this.d.hostId, v: PROTOCOL_VERSION }));
      return;
    }

    if (msg.t === 'pair' && msg.d && msg.n && msg.c) {
      const p = this.pending;
      const fail = (code: string) => conn.send(JSON.stringify({ t: 'pair-err', code }));
      if (!p || p.expiresAt < this.now()) return fail('QP_PAIRING_EXPIRED');
      if (!shop) return fail('QP_NOT_FOUND');
      if (!this.d.planActive()) return fail('QP_PRO_REQUIRED');
      const body = open<{ key: string; name?: string }>(msg.n, msg.c, p.key);
      if (!body?.key) return fail('QP_PAIRING_EXPIRED');
      this.pending = null; // dùng một lần
      const userId = `lan-${msg.d}`;
      const old = this.devices.find((x) => x.deviceId === msg.d);
      if (old) this.devices = this.devices.filter((x) => x.deviceId !== msg.d);
      const dev: LanDevice = {
        deviceId: msg.d, name: body.name?.trim().slice(0, 40) || p.name, role: p.role, key: body.key, userId,
        pairedAt: new Date(this.now()).toISOString(), lastSeenAt: null, seq: 0,
      };
      this.devices.push(dev);
      this.d.saveDevices(this.devices);
      this.d.addMember(shop.businessId, userId, p.role, dev.name);
      bind(dev.deviceId);
      conn.send(JSON.stringify({
        t: 'paired',
        ...seal({ hostId: this.d.hostId, role: dev.role, userId, businessId: shop.businessId, shopName: shop.name, staffName: dev.name }, dev.key),
      }));
      return;
    }

    if (msg.t === 'req' && msg.d && msg.n && msg.c) {
      const dev = this.devices.find((x) => x.deviceId === msg.d);
      if (!dev) {
        conn.send(JSON.stringify({ t: 'unpaired' }));
        return;
      }
      const body = open<{ id: string; seq: number; req: LanRequest }>(msg.n, msg.c, dev.key);
      if (!body || typeof body.seq !== 'number' || body.seq <= dev.seq) return; // sai khóa hoặc tin gửi lại
      dev.seq = body.seq;
      dev.lastSeenAt = new Date(this.now()).toISOString();
      // Ghi số thứ tự ngay: tắt mở lại máy chủ quán vẫn chặn được tin cũ bị gửi lại
      this.d.saveDevices(this.devices);
      bind(dev.deviceId);
      let res: LanResult;
      if (!this.d.planActive()) res = { data: null, error: { message: 'QP_PRO_REQUIRED' } };
      else {
        try {
          res = await this.d.execute(dev.userId, body.req);
        } catch (e) {
          res = { data: null, error: { message: e instanceof Error ? e.message : 'QP_UNKNOWN' } };
        }
      }
      conn.send(JSON.stringify({ t: 'res', ...seal({ id: body.id, ...res }, dev.key) }));
    }
  }
}
