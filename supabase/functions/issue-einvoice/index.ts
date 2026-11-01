// issue-einvoice — app gửi { invoice_id } (hóa đơn nháp đã lập bằng create_invoice_from_order_v1), nhận hóa đơn đã phát hành.
// Đọc hóa đơn bằng JWT người gọi (RLS) → chỉ thành viên hộ phát hành được.
//  - DEMO: tự cấp số bằng issue_invoice() (dãy liên tục theo hộ/mẫu/ký hiệu/năm) + mã cơ quan thuế bản thử.
//  - MISA / VIETTEL / VNPT / OTHER: nhà cung cấp tự cấp số (hóa đơn máy tính tiền) → lưu số của họ bằng
//    record_einvoice_result(), KHÔNG gọi issue_invoice(). TODO: viết adapter khi có tài liệu sandbox + tài khoản kết nối.
import { json, qpError, serviceClient, userClient } from '../_shared/http.ts';
import { demoTaxAuthorityCode, providerReady, type EinvoiceProvider } from '../_shared/einvoice.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let invoiceId: unknown;
  try {
    ({ invoice_id: invoiceId } = await req.json());
  } catch {
    return qpError(400, 'QP_INVALID_INPUT');
  }
  if (typeof invoiceId !== 'string' || !UUID.test(invoiceId)) return qpError(400, 'QP_INVALID_INPUT');

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return qpError(401, 'QP_UNAUTHENTICATED');

  const { data: inv } = await db.from('invoices').select('id, business_id, status').eq('id', invoiceId).maybeSingle();
  if (!inv) return qpError(404, 'QP_NOT_FOUND');
  const svc = serviceClient();
  if (inv.status !== 'DRAFT') {
    const { data: done } = await svc.from('invoices').select('*').eq('id', invoiceId).single();
    return json(200, done);                                   // gửi lại: trả hóa đơn đã phát hành
  }

  const { data: biz } = await db.from('businesses').select('einvoice_provider').eq('id', inv.business_id).single();
  const provider = (biz?.einvoice_provider ?? 'NONE') as EinvoiceProvider;
  if (provider === 'NONE') return qpError(409, 'QP_EINVOICE_NOT_SETUP');
  if (!providerReady(provider)) return qpError(501, 'QP_EINVOICE_PROVIDER_NOT_READY');

  // DEMO: cấp số bằng hàm của DB (quyền người gọi), rồi ghi mã cơ quan thuế bản thử
  const { data: issued, error } = await db.rpc('issue_invoice', { p_invoice_id: invoiceId });
  if (error || !issued) return qpError(500, 'UNKNOWN');
  const year = issued.fiscal_year as number;
  const { data: updated, error: e2 } = await svc
    .from('invoices')
    .update({ tax_authority_code: demoTaxAuthorityCode(year, issued.invoice_no), provider_ref: `demo-${issued.invoice_no}` })
    .eq('id', invoiceId)
    .select('*')
    .single();
  if (e2) return qpError(500, 'UNKNOWN');
  return json(200, updated);
});
