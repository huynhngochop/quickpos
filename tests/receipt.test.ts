import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptHtml, receiptText, revenueBookHtml } from '../src/features/receipt/receipt';

const order = {
  shopName: 'Quán Cô Ba <HCM>',
  orderCode: 'ABCD2345',
  soldAt: '2026-11-01T02:05:00Z', // 09:05 giờ VN
  method: 'CASH' as const,
  items: [
    { name: 'Cà phê sữa', quantity: 2, unit_price: 20000, line_amount: 40000 },
    { name: 'Bánh mì', quantity: 1.5, unit_price: 15000, line_amount: 22500 },
  ],
  total: 62500,
  received: 100000,
  customerName: 'Anh Bảy',
};

test('biên nhận dạng chữ: giờ VN, dòng hàng, tiền thối', () => {
  const t = receiptText(order);
  assert.match(t, /09:05 01\/11\/2026/);
  assert.match(t, /Cà phê sữa\n {2}2 x 20\.000 = 40\.000 đ/);
  assert.match(t, /1,5 x 15\.000 = 22\.500 đ/);
  assert.match(t, /Tổng cộng: 62\.500 đ/);
  assert.match(t, /Thối lại: 37\.500 đ/);
  assert.match(t, /Khách: Anh Bảy/);
  assert.doesNotMatch(receiptText({ ...order, method: 'VIETQR' }), /Thối lại/);
});

test('biên nhận HTML khổ 58 mm, thoát ký tự đặc biệt', () => {
  const h = receiptHtml(order);
  assert.match(h, /size:58mm/);
  assert.match(h, /Quán Cô Ba &lt;HCM&gt;/);
  assert.match(h, /62\.500 đ/);
});

test('sổ doanh thu HTML có dòng tổng', () => {
  const h = revenueBookHtml({
    shopName: 'Quán', taxCode: '0312345678', title: 'Sổ doanh thu 10/2026',
    rows: [{ day: '2026-10-01', revenue: 100000, expense: 20000 }, { day: '2026-10-02', revenue: 50000, expense: 0 }],
  });
  assert.match(h, /01\/10\/2026/);
  assert.match(h, /<td>Tổng<\/td><td class="r">150\.000<\/td><td class="r">20\.000<\/td>/);
});
