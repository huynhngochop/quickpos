// qr-for-order — app gửi { order_id }, nhận chuỗi VietQR để vẽ mã cho khách quét.
// Đọc đơn bằng JWT của người gọi (RLS: chỉ thành viên hộ thấy đơn) → không lộ đơn hộ khác.
// Số tiền trên mã = phần CÒN THIẾU (đơn chuyển thiếu thì mã mới chỉ cho phần còn lại).
//
// Bản này dùng tài khoản chính của hộ + mã đơn trong nội dung (khách phải giữ nguyên nội dung).
// TODO: tài khoản ảo theo đơn (payment_accounts.kind = 'ORDER_VA') qua API của cổng — đọc tài liệu cổng
//       đang dùng rồi mới viết; cổng chậm > 3 s thì quay về cách hiện tại.
import { buildVietQr } from '../_shared/vietqr.ts';
import { bankDisplayName } from '../_shared/banks.ts';
import { json, qpError, userClient } from '../_shared/http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let orderId: unknown;
  try {
    ({ order_id: orderId } = await req.json());
  } catch {
    return qpError(400, 'QP_INVALID_INPUT');
  }
  if (typeof orderId !== 'string' || !UUID.test(orderId)) return qpError(400, 'QP_INVALID_INPUT');

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return qpError(401, 'QP_UNAUTHENTICATED');

  const { data: order, error } = await db
    .from('orders')
    .select('id, business_id, order_code, total_amount, amount_received, payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return qpError(500, 'UNKNOWN');
  if (!order) return qpError(404, 'QP_NOT_FOUND');
  if (order.payment_status !== 'UNPAID') return qpError(409, 'QP_ORDER_NOT_PAYABLE');

  const amount = order.total_amount - order.amount_received;
  if (amount <= 0) return qpError(409, 'QP_ORDER_NOT_PAYABLE');

  const [{ data: account }, { data: biz }] = await Promise.all([
    db.from('payment_accounts')
      .select('bank_bin, account_no')
      .eq('business_id', order.business_id)
      .eq('kind', 'MAIN')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    db.from('businesses').select('bank_account_name').eq('id', order.business_id).maybeSingle(),
  ]);
  if (!account) return qpError(409, 'QP_NO_PAYMENT_ACCOUNT');

  return json(200, {
    qr_payload: buildVietQr({
      bankBin: account.bank_bin,
      accountNo: account.account_no,
      amount,
      content: order.order_code,
    }),
    bank_name: bankDisplayName(account.bank_bin),
    account_name: biz?.bank_account_name ?? '',
    amount,
    uses_order_code: true,
    order_code: order.order_code,
    expires_at: null,
  });
});
