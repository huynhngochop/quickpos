import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoClient } from '../src/lib/demoClient';
import { vnDay } from '../src/lib/time';

test('dùng thử: sổ nợ, chi tiêu, ngành nghề thuế', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const c = createDemoClient();
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const p = c.rpc(name, args).then((x) => x);
    mock.timers.tick(300);
    await new Promise((r) => setImmediate(r));
    return p;
  };
  await c.auth.verifyOtp({ phone: '+84903456789', token: '123456' });
  await rpc('create_business_v1', { p_business_id: 'b1', p_business_name: 'Tạp hóa', p_tax_code: '0312345678', p_address: 'HCM' });

  // Dữ liệu mẫu: 2 khách nợ, Chị Hoa còn 85.000
  const debtors = (await c.from('debt_balances').select('*').eq('business_id', 'b1').order('balance', { ascending: false })).data;
  assert.deepEqual(debtors.map((d: { name: string; balance: number }) => [d.name, d.balance]), [['Chị Hoa', 85000], ['Anh Tư xe ôm', 40000]]);

  assert.equal((await rpc('add_debt_customer_v1', { p_customer_id: 'k1', p_business_id: 'b1', p_name: 'Cô Năm', p_phone: '0909 000 111', p_phone_consent: false })).error?.message, 'QP_CONSENT_REQUIRED');
  await rpc('add_debt_customer_v1', { p_customer_id: 'k1', p_business_id: 'b1', p_name: 'Cô Năm', p_phone: '0909 000 111', p_phone_consent: true });
  await rpc('record_debt_v1', { p_entry_id: 'd1', p_customer_id: 'k1', p_kind: 'DEBT', p_amount: 60000 });
  await rpc('record_debt_v1', { p_entry_id: 'd1', p_customer_id: 'k1', p_kind: 'DEBT', p_amount: 60000 });
  assert.equal((await rpc('record_debt_v1', { p_entry_id: 'd2', p_customer_id: 'k1', p_kind: 'PAYMENT', p_amount: 70000 })).error?.message, 'QP_PAYMENT_EXCEEDS_DEBT');
  await rpc('record_debt_v1', { p_entry_id: 'd3', p_customer_id: 'k1', p_kind: 'PAYMENT', p_amount: 20000 });
  const nam = (await c.from('debt_balances').select('*').eq('customer_id', 'k1')).data[0];
  assert.equal(nam.balance, 40000);
  assert.equal(nam.phone, '0909000111');
  await rpc('void_debt_entry_v1', { p_entry_id: 'd3' });
  assert.equal((await c.from('debt_balances').select('*').eq('customer_id', 'k1')).data[0].balance, 60000);

  // Chi tiêu: mẫu 485.000; thêm 100.000 (gửi lại không trùng); hủy khoản đó
  const today = vnDay();
  const list = async () =>
    (await c.from('journal_entries').select('*').eq('business_id', 'b1').eq('entry_type', 'EXPENSE').is('voided_at', null).gte('entry_date', '2000-01-01').lte('entry_date', today)).data;
  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
  assert.equal(sum(await list()), 485000);
  await rpc('add_expense_v1', { p_entry_id: 'x1', p_business_id: 'b1', p_amount: 100000, p_category: 'Điện nước' });
  await rpc('add_expense_v1', { p_entry_id: 'x1', p_business_id: 'b1', p_amount: 100000, p_category: 'Điện nước' });
  assert.equal(sum(await list()), 585000);
  await rpc('void_expense_v1', { p_business_id: 'b1', p_entry_id: 'x1' });
  assert.equal(sum(await list()), 485000);

  const b = await rpc('update_tax_settings_v1', { p_business_id: 'b1', p_tax_industry: 'PRODUCTION' });
  assert.equal(b.data.tax_industry, 'PRODUCTION');
  mock.timers.reset();
});
