/**
 * Gắn giao thức máy chủ quán vào TCP thật (react-native-tcp-socket) và dò máy chủ quán trong mạng Wi‑Fi.
 */
import TcpSocket from 'react-native-tcp-socket';
import NetInfo from '@react-native-community/netinfo';
import { LineBuffer, type LineConn } from './protocol';

type Sock = {
  on(ev: string, cb: (x?: unknown) => void): void;
  write(s: string): void;
  destroy(): void;
  setEncoding(e: string): void;
};

function wrap(sock: Sock): LineConn {
  const buf = new LineBuffer();
  const lineCbs: ((l: string) => void)[] = [];
  const closeCbs: (() => void)[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const c of closeCbs) c();
  };
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    try {
      for (const l of buf.push(String(chunk))) for (const cb of lineCbs) cb(l);
    } catch {
      sock.destroy();
    }
  });
  sock.on('error', () => close());
  sock.on('close', () => close());
  return {
    send: (line) => {
      if (!closed) sock.write(`${line}\n`);
    },
    onLine: (cb) => void lineCbs.push(cb),
    onClose: (cb) => void closeCbs.push(cb),
    close: () => {
      sock.destroy();
      close();
    },
  };
}

/** Mở máy chủ TCP trên mọi địa chỉ của máy, cổng port. */
export function listen(port: number, onConn: (c: LineConn) => void): { close: () => void } {
  // Ép kiểu: chỉ dùng vài hàm của Socket (on/write/destroy/setEncoding)
  const server = TcpSocket.createServer(((sock: Sock) => onConn(wrap(sock))) as never);
  server.on('error', () => {});
  server.listen({ port, host: '0.0.0.0' });
  return { close: () => server.close() };
}

export function connect(host: string, port: number, timeoutMs: number): Promise<LineConn> {
  return new Promise((resolve, reject) => {
    let done = false;
    const sock = TcpSocket.createConnection({ host, port, connectTimeout: timeoutMs }, () => {
      done = true;
      clearTimeout(t);
      resolve(wrap(sock as unknown as Sock));
    });
    sock.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      reject(e instanceof Error ? e : new Error('CONNECT_FAILED'));
    });
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      sock.destroy();
      reject(new Error('CONNECT_TIMEOUT'));
    }, timeoutMs + 200);
  });
}

/** IP Wi‑Fi của máy này (để hiện trong mã QR ghép máy) */
export async function wifiIp(): Promise<string | null> {
  const s = await NetInfo.fetch('wifi');
  const ip = (s.details as { ipAddress?: string } | null)?.ipAddress;
  return s.type === 'wifi' && ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null;
}

/** Thử một máy: có phải máy chủ quán mang mã hostId không */
async function probe(ip: string, port: number, hostId: string): Promise<boolean> {
  try {
    const c = await connect(ip, port, 400);
    return await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        c.close();
        resolve(false);
      }, 800);
      c.onLine((l) => {
        try {
          const m = JSON.parse(l) as { t?: string; hostId?: string };
          if (m.t === 'hello') {
            clearTimeout(t);
            c.close();
            resolve(m.hostId === hostId);
          }
        } catch {
          /* bỏ qua */
        }
      });
      c.send(JSON.stringify({ t: 'hello' }));
    });
  } catch {
    return false;
  }
}

/** Dò cả mạng con /24 của máy này (24 máy một lượt), dừng khi thấy. Khoảng vài giây. */
export async function scanForHost(port: number, hostId: string): Promise<string | null> {
  const me = await wifiIp();
  if (!me) return null;
  const base = me.split('.').slice(0, 3).join('.');
  const ips = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`).filter((ip) => ip !== me);
  for (let i = 0; i < ips.length; i += 24) {
    const batch = ips.slice(i, i + 24);
    const hits = await Promise.all(batch.map(async (ip) => ((await probe(ip, port, hostId)) ? ip : null)));
    const hit = hits.find(Boolean);
    if (hit) return hit;
  }
  return null;
}
