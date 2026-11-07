/**
 * Máy chủ quán giả bằng Node (TCP thật) để thử scripts/qa-lan-client.ts trên máy tính, không cần máy ảo:
 *   npx tsx scripts/qa-lan-host-sim.ts            → in mã ghép máy, mở cổng 47123
 *   npx tsx scripts/qa-lan-client.ts '<mã>'       → (cửa sổ khác) chạy như trên CI
 * QA_SIM_SELFTEST=1: tự chạy client rồi thoát (mã thoát của client).
 */
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { addLanMember, createDemoClient, hostExecute, onAnyOrder, removeLanMember, setSampleMode } from '../src/lib/demoClient';
import { LanHost, type LanDevice } from '../src/features/lan/host';
import { LAN_PORT, LineBuffer, encodePairingQr, type LineConn } from '../src/features/lan/protocol';

async function main() {
  setSampleMode(false);
  const local = createDemoClient();
  await local.auth.verifyOtp({ phone: '+84903000999', token: '123456' });
  await local.rpc('create_business_v1', { p_business_id: 'sim1', p_business_name: 'Quán thử', p_tax_code: '0312345678', p_address: 'HCM' });
  let saved: LanDevice[] = [];
  const host = new LanHost({
    hostId: 'SIMHOST',
    shop: () => ({ businessId: 'sim1', name: 'Quán thử' }),
    planActive: () => true,
    loadDevices: () => saved,
    saveDevices: (d) => (saved = d),
    addMember: addLanMember,
    removeMember: removeLanMember,
    execute: (userId, req) => hostExecute(userId, req as never, (n, o) => local.functions.invoke(n, o as never) as never),
  });
  onAnyOrder((row) => host.broadcastOrder(row));
  const server = net.createServer((sock) => {
    const buf = new LineBuffer();
    const lines: ((l: string) => void)[] = [];
    const closes: (() => void)[] = [];
    sock.setEncoding('utf8');
    sock.on('data', (c) => {
      for (const l of buf.push(String(c))) for (const cb of lines) cb(l);
    });
    sock.on('close', () => closes.forEach((c) => c()));
    sock.on('error', () => undefined);
    const conn: LineConn = {
      send: (l) => void sock.write(`${l}\n`),
      onLine: (cb) => void lines.push(cb),
      onClose: (cb) => void closes.push(cb),
      close: () => sock.destroy(),
    };
    host.attach(conn);
  });
  await new Promise<void>((r) => server.listen(LAN_PORT, '127.0.0.1', r));
  const p = host.startPairing('CASHIER', 'Thu ngân');
  const code = encodePairingQr({ h: '10.0.2.16', p: LAN_PORT, i: 'SIMHOST', k: p.key });
  console.log(code);
  if (process.env.QA_SIM_SELFTEST === '1') {
    // Chạy client ở tiến trình con nhưng không chặn vòng sự kiện của máy chủ
    const { spawn } = await import('node:child_process');
    const child = spawn('npx', ['tsx', 'scripts/qa-lan-client.ts', code], { stdio: 'inherit' });
    child.on('exit', (c) => {
      console.log(`thiết bị: ${saved.map((d) => d.name).join(', ')}`);
      server.close();
      process.exit(c ?? 1);
    });
  }
  void spawnSync;
}

void main();
