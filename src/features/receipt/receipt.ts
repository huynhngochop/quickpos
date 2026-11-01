/**
 * Biên nhận bán hàng (KHÔNG phải hóa đơn): chữ để gửi qua Zalo/SMS và HTML khổ 58 mm để in.
 * Hàm thuần — kiểm thử ở tests/receipt.test.ts.
 */
import { formatVND, groupDigits } from '../../lib/money';
import { formatDateVN, formatTimeVN } from '../../lib/time';

export interface ReceiptInput {
  shopName: string;
  shopAddress?: string;
  orderCode: string;
  soldAt: string;
  method: 'VIETQR' | 'CASH' | 'CARD';
  items: { name: string; quantity: number; unit_price: number; line_amount: number }[];
  total: number;
  received?: number;
  customerName?: string | null;
}

const METHOD = { VIETQR: 'Chuyển khoản', CASH: 'Tiền mặt', CARD: 'Thẻ' } as const;
const qty = (q: number) => (Number.isInteger(q) ? String(q) : String(q).replace('.', ','));

export function receiptText(r: ReceiptInput): string {
  const lines = [
    r.shopName,
    ...(r.shopAddress ? [r.shopAddress] : []),
    `Biên nhận · Đơn ${r.orderCode}`,
    `${formatTimeVN(r.soldAt)} ${formatDateVN(r.soldAt)}`,
    ...(r.customerName ? [`Khách: ${r.customerName}`] : []),
    '----------------',
    ...r.items.map((i) => `${i.name}\n  ${qty(i.quantity)} x ${groupDigits(i.unit_price)} = ${formatVND(i.line_amount)}`),
    '----------------',
    `Tổng cộng: ${formatVND(r.total)}`,
    `Trả bằng: ${METHOD[r.method]}`,
    ...(r.method === 'CASH' && r.received && r.received > r.total ? [`Khách đưa: ${formatVND(r.received)}`, `Thối lại: ${formatVND(r.received - r.total)}`] : []),
    'Cảm ơn quý khách!',
  ];
  return lines.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML cho máy in nhiệt 58 mm (khổ giấy 48 mm in được) hoặc in ra PDF. */
export function receiptHtml(r: ReceiptInput): string {
  const rows = r.items
    .map(
      (i) =>
        `<tr><td colspan="2">${esc(i.name)}</td></tr><tr><td class="m">${qty(i.quantity)} x ${groupDigits(i.unit_price)}</td><td class="r">${groupDigits(i.line_amount)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:58mm auto;margin:3mm}body{font-family:sans-serif;font-size:12px;width:52mm;margin:0;color:#000}
h1{font-size:15px;text-align:center;margin:0 0 2px}p{margin:0;text-align:center}table{width:100%;border-collapse:collapse;margin:6px 0}
td{padding:1px 0;vertical-align:top}.r{text-align:right}.m{color:#333}.t td{font-size:15px;font-weight:bold;border-top:1px dashed #000;padding-top:4px}
.f{margin-top:8px;text-align:center}</style></head><body>
<h1>${esc(r.shopName)}</h1>${r.shopAddress ? `<p>${esc(r.shopAddress)}</p>` : ''}
<p>Biên nhận · Đơn ${esc(r.orderCode)}</p><p>${formatTimeVN(r.soldAt)} ${formatDateVN(r.soldAt)}</p>
${r.customerName ? `<p>Khách: ${esc(r.customerName)}</p>` : ''}
<table>${rows}<tr class="t"><td>Tổng cộng</td><td class="r">${groupDigits(r.total)} đ</td></tr></table>
<p>Trả bằng: ${METHOD[r.method]}</p><p class="f">Cảm ơn quý khách!</p></body></html>`;
}

/** Sổ doanh thu theo ngày dạng bảng HTML (in hoặc lưu PDF gửi kế toán). */
export function revenueBookHtml(p: {
  shopName: string; taxCode: string; title: string; rows: { day: string; revenue: number; expense: number }[];
}): string {
  const total = p.rows.reduce((s, r) => ({ revenue: s.revenue + r.revenue, expense: s.expense + r.expense }), { revenue: 0, expense: 0 });
  const tr = p.rows
    .map((r) => `<tr><td>${r.day.slice(8, 10)}/${r.day.slice(5, 7)}/${r.day.slice(0, 4)}</td><td class="r">${groupDigits(r.revenue)}</td><td class="r">${groupDigits(r.expense)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:sans-serif;font-size:12px;margin:16mm}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{border:1px solid #999;padding:4px 6px}th{background:#eee}.r{text-align:right}tfoot td{font-weight:bold}.n{color:#555;margin-top:8px}
</style></head><body><h1>${esc(p.title)}</h1><div>${esc(p.shopName)} · Mã số thuế ${esc(p.taxCode)}</div>
<table><thead><tr><th>Ngày</th><th>Doanh thu (đồng)</th><th>Chi phí (đồng)</th></tr></thead><tbody>${tr}</tbody>
<tfoot><tr><td>Tổng</td><td class="r">${groupDigits(total.revenue)}</td><td class="r">${groupDigits(total.expense)}</td></tr></tfoot></table>
<div class="n">Số liệu từ QuickPOS, tham khảo khi kê khai thuế, không thay thế tư vấn thuế.</div></body></html>`;
}
