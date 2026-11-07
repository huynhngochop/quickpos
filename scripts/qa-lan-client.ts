/**
 * QA hai máy (gói Pro): đóng vai máy nhân viên thật, nối TCP vào máy chủ quán chạy trên máy ảo Android
 * (qua `adb forward tcp:47123 tcp:47123`). Dùng đúng mã giao thức của app (src/features/lan).
 *
 *   npx tsx scripts/qa-lan-client.ts '<mã QPLAN1:...>' [kết-quả.json]
 *
 * Làm: ghép máy bằng mã → bán một đơn tiền mặt 23.000 đ → đọc lại đơn → đọc sổ hôm nay → nối lại lần hai.
 * Thoát 0 nếu mọi bước đúng; in từng bước ra màn hình.
 */
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { LineBuffer, decodePairingQr, type LineConn } from '../src/features/lan/protocol';
import { LanClient, pairWithHost } from '../src/features/lan/client';

const code = process.argv[2] ?? '';
const out = process.argv[3];
const HOST = process.env.QA_LAN_HOST ?? '127.0.0.1';

function connect(_host: string, port: number, timeoutMs: number): Promise<LineConn> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: HOST, port });
    const buf = new LineBuffer();
    const lineCbs: ((l: string) => void)[] = [];
    const closeCbs: (() => void)[] = [];
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      for (const c of closeCbs) c();
    };
    const t = setTimeout(() => {
      sock.destroy();
      reject(new Error('CONNECT_TIMEOUT'));
    }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('connect', () => {
      clearTimeout(t);
      resolve({
        send: (l) => void (!closed && sock.write(`${l}\n`)),
        onLine: (cb) => void lineCbs.push(cb),
        onClose: (cb) => void closeCbs.push(cb),
        close: () => {
          sock.destroy();
          close();
        },
      });
    });
    sock.on('data', (chunk) => {
      for (const l of buf.push(String(chunk))) for (const cb of lineCbs) cb(l);
    });
    sock.on('error', (e) => {
      clearTimeout(t);
      reject(e);
      close();
    });
    sock.on('close', close);
  });
}

const steps: { step: string; ok: boolean; detail?: unknown }[] = [];
function check(step: string, ok: boolean, detail?: unknown) {
  steps.push({ step, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${step}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 300)}`}`);
  if (!ok) finish(1);
}
function finish(codeOut: number): never {
  if (out) writeFileSync(out, JSON.stringify({ ok: codeOut === 0, steps }, null, 2));
  process.exit(codeOut);
}

async function main() {
  const qr = decodePairingQr(code.trim());
  check('đọc mã ghép máy', !!qr, qr ? { host: qr.h, port: qr.p } : code.slice(0, 40));
  const deviceId = `qa-${randomUUID().slice(0, 8)}`;
  const pairing = await pairWithHost(connect, qr!, deviceId, 'Thu ngan Lan');
  check('ghép máy', pairing.role === 'CASHIER' && !!pairing.businessId, { role: pairing.role, shop: pairing.shopName });

  const client = new LanClient({ ...pairing, hostIp: HOST }, connect, async () => null);
  client.onPush(() => undefined);
  const orderId = randomUUID();
  const sale = await client.request({
    kind: 'rpc',
    name: 'create_cash_sale_v1',
    args: {
      p_order_id: orderId, p_business_id: pairing.businessId, p_device_id: deviceId,
      p_items: [{ name: 'Banh mi QA', quantity: 1, unit_price: 23000 }],
    },
  });
  check('máy nhân viên bán đơn tiền mặt 23.000 đ', !sale.error, sale.error ?? undefined);

  // Gửi lại đúng lệnh (mạng chập chờn): không tạo đơn thứ hai
  const again = await client.request({
    kind: 'rpc',
    name: 'create_cash_sale_v1',
    args: {
      p_order_id: orderId, p_business_id: pairing.businessId, p_device_id: deviceId,
      p_items: [{ name: 'Banh mi QA', quantity: 1, unit_price: 23000 }],
    },
  });
  check('gửi lại lệnh bán không tạo đơn trùng', !again.error, again.error ?? undefined);

  const read = await client.request({ kind: 'select', table: 'orders', ops: [{ m: 'select', a: ['*'] }, { m: 'eq', a: ['id', orderId] }, { m: 'single', a: [] }] });
  const o = read.data as { total_amount?: number; payment_status?: string } | null;
  check('đọc lại đơn từ máy chủ quán', o?.total_amount === 23000 && o?.payment_status === 'PAID', o);

  const forbidden = await client.request({ kind: 'rpc', name: 'set_pro_license_v1', args: { p_business_id: pairing.businessId, p_code: 'x' } });
  check('máy nhân viên không được đổi gói', !!forbidden.error, forbidden.error);

  // Ngắt rồi nối lại (máy nhân viên tắt mở app)
  client.close();
  const client2 = new LanClient({ ...pairing, hostIp: HOST }, connect, async () => null);
  const list = await client2.request({
    kind: 'select', table: 'orders',
    ops: [{ m: 'select', a: ['id'] }, { m: 'eq', a: ['business_id', pairing.businessId] }],
  });
  const ids = ((list.data as { id: string }[] | null) ?? []).map((x) => x.id);
  check('nối lại, thấy đơn vừa bán đúng một lần', ids.filter((x) => x === orderId).length === 1, { orders: ids.length });
  client2.close();
  finish(0);
}

main().catch((e) => check('lỗi không mong đợi', false, String(e?.message ?? e)));
