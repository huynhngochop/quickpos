import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { attachStorage, createDemoClient, exportBackup, parseBackup, restoreBackup, setSampleMode } from '../src/lib/demoClient';
import { backupFileName } from '../src/features/backup/name';

// Chế độ lưu trên máy (bản phát hành chưa có máy chủ): không dữ liệu mẫu, dữ liệu lưu bền, sao lưu/khôi phục bằng file
test('lưu trên máy: quán trống, tự nhập tài khoản, xác nhận tay, đăng xuất không mất, sao lưu và khôi phục', async () => {
  setSampleMode(false);
  mock.timers.enable({ apis: ['setTimeout'] });
  let saved: string | null = null;
  attachStorage({ load: () => saved, save: (j) => (saved = j) });
  const c = createDemoClient();
  const tick = async (ms = 300) => {
    mock.timers.tick(ms);
    await new Promise((r) => setImmediate(r));
  };
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const p = c.rpc(name, args).then((x) => x);
    await tick(260);
    return p;
  };

  await c.auth.verifyOtp({ phone: '+84903111222', token: '123456' });
  assert.ok(saved, 'đăng nhập ghi xuống máy ngay');
  await rpc('create_business_v1', { p_business_id: 'b1', p_business_name: 'Tạp hóa Cô Tư', p_tax_code: '0312345678', p_address: 'HCM' });

  // Không có dữ liệu mẫu
  assert.equal((await c.from('orders').select('*').eq('business_id', 'b1')).data.length, 0);
  assert.equal((await c.from('products').select('*').eq('business_id', 'b1')).data.length, 0);
  assert.equal((await c.from('payment_accounts').select('*').eq('business_id', 'b1')).data.length, 0);

  // Bán chuyển khoản khi chưa có tài khoản → báo thiếu tài khoản
  await rpc('create_order_v1', { p_order_id: 'o1', p_business_id: 'b1', p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 18000 }] });
  const noAcc = await c.functions.invoke('qr-for-order', { body: { order_id: 'o1' } });
  assert.equal(noAcc.error?.message, 'QP_NO_PAYMENT_ACCOUNT');

  // Tự nhập tài khoản → mã QR mang đúng ngân hàng, số tài khoản
  assert.equal((await rpc('set_local_payment_account_v1', { p_business_id: 'b1', p_bank_bin: '970436', p_account_no: '12', p_account_name: 'CO TU' })).error?.message, 'QP_INVALID_INPUT');
  await rpc('set_local_payment_account_v1', { p_business_id: 'b1', p_bank_bin: '970436', p_account_no: '0071000123456', p_account_name: 'nguyen thi tu' });
  const qr = await c.functions.invoke('qr-for-order', { body: { order_id: 'o1' } });
  assert.equal(qr.error, null);
  assert.equal(qr.data.bank_name, 'Vietcombank');
  assert.equal(qr.data.account_name, 'NGUYEN THI TU');
  assert.match(qr.data.qr_payload, /970436/);
  assert.match(qr.data.qr_payload, /0071000123456/);

  // Không giả lập khách chuyển tiền: sau 2 phút đơn vẫn chờ
  await tick(120_000);
  assert.equal((await c.from('orders').select('*').eq('id', 'o1')).data[0].payment_status, 'UNPAID');
  // Xác nhận tay → đã trả đủ, không nằm trong mục "chưa thấy tiền về"
  await rpc('confirm_transfer_manually_v1', { p_order_id: 'o1' });
  const o1 = (await c.from('orders').select('*').eq('id', 'o1')).data[0];
  assert.equal(o1.payment_status, 'PAID');
  assert.equal(o1.amount_received, 18000);
  await tick(20 * 60_000);
  assert.equal((await c.from('unreconciled_manual_confirmations').select('*').eq('business_id', 'b1')).data.length, 0);
  await rpc('create_cash_sale_v1', { p_order_id: 'o2', p_business_id: 'b1', p_items: [{ name: 'Bán hàng', quantity: 2, unit_price: 10000 }] });
  await tick(400);
  assert.match(saved!, /"o2"/, 'mỗi lệnh ghi xuống máy');

  // Đăng xuất: dữ liệu vẫn còn; tắt app mở lại (nạp từ máy) rồi đăng nhập lại cùng số → thấy lại quán
  await c.auth.signOut();
  const afterLogout = saved!;
  attachStorage({ load: () => null, save: () => {} }); // mô phỏng máy khác, trống
  attachStorage({ load: () => afterLogout, save: (j) => (saved = j) }); // mở lại app trên máy cũ
  assert.equal((await c.auth.getSession()).data.session, null);
  await c.auth.verifyOtp({ phone: '+84903111222', token: '654321' });
  const mine = (await c.from('business_members').select('*').eq('user_id', 'demo-user-84903111222')).data;
  assert.equal(mine.length, 1);
  assert.equal((await c.from('orders').select('*').eq('business_id', 'b1')).data.length, 2);

  // Sao lưu ra file → máy mới đăng nhập số khác → khôi phục
  const file = exportBackup('b1');
  assert.equal(file.orders, 2);
  assert.equal(file.business_name, 'Tạp hóa Cô Tư');
  assert.equal(file.tables.order_items!.length, 2);
  const text = JSON.stringify(file);
  assert.equal(parseBackup('{"app":"Khac"}'), null);
  assert.equal(parseBackup('không phải json'), null);
  const parsed = parseBackup(text)!;
  assert.ok(parsed);

  attachStorage({ load: () => null, save: (j) => (saved = j) });
  await c.auth.verifyOtp({ phone: '+84988777666', token: '111111' });
  assert.equal((await c.from('business_members').select('*').eq('user_id', 'demo-user-84988777666')).data.length, 0);
  const r = restoreBackup(parsed);
  assert.equal(r.businessId, 'b1');
  const m2 = (await c.from('business_members').select('*').eq('user_id', 'demo-user-84988777666')).data;
  assert.equal(m2[0].role, 'OWNER');
  assert.equal((await c.from('orders').select('*').eq('business_id', 'b1')).data.length, 2);
  assert.equal((await c.from('payment_accounts').select('*').eq('business_id', 'b1').eq('is_active', true)).data[0].account_no, '0071000123456');
  assert.match(saved!, /demo-user-84988777666/, 'khôi phục ghi xuống máy ngay');

  assert.equal(backupFileName('Tạp hóa Cô Tư', '2026-11-07'), 'QuickPOS-tap-hoa-co-tu-2026-11-07.json');
  assert.equal(backupFileName('!!!', '2026-11-07'), 'QuickPOS-quan-2026-11-07.json');
  mock.timers.reset();
  setSampleMode(true);
});
