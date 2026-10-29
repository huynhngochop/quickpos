// payment-webhook/<provider> — nhận báo có tiền về từ cổng thanh toán.
// Thứ tự: xác thực → chuẩn hóa → confirm_payment() bằng service_role → trả 200 cho cổng.
// confirm_payment chạy ~1 ms (đã đo), nên gọi trực tiếp rồi mới trả lời: nếu DB lỗi, trả 500 để cổng gửi lại
// (an toàn vì confirm_payment chống trùng theo (provider, provider_txn_id)).
//
// Secrets: SEPAY_WEBHOOK_SECRET (HMAC, ưu tiên) hoặc SEPAY_API_KEY. Không có cái nào → từ chối mọi request.
// Deploy: supabase functions deploy payment-webhook --no-verify-jwt   (cổng không có JWT của Supabase)
import { parseSepay, SEPAY_ACK, verifySepayApiKey, verifySepayHmac } from '../_shared/sepay.ts';
import { json, log, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const provider = new URL(req.url).pathname.split('/').filter(Boolean).pop()?.toLowerCase();

  if (provider === 'sepay') return handleSepay(req);
  if (provider === 'payos') {
    // TODO: PayOS — xác thực `signature` theo tài liệu PayOS (checksum key) trước khi viết. Không đoán định dạng.
    return json(501, { error: 'not_implemented' });
  }
  return json(404, { error: 'unknown_provider' });
});

async function handleSepay(req: Request): Promise<Response> {
  const raw = await req.text();
  const secret = Deno.env.get('SEPAY_WEBHOOK_SECRET') ?? '';
  const apiKey = Deno.env.get('SEPAY_API_KEY') ?? '';

  let authed = false;
  if (secret) {
    authed = await verifySepayHmac(
      req.headers.get('X-SePay-Signature'),
      req.headers.get('X-SePay-Timestamp'),
      raw,
      secret,
      Math.floor(Date.now() / 1000),
    );
  } else if (apiKey) {
    authed = verifySepayApiKey(req.headers.get('Authorization'), apiKey);
  }
  if (!authed) {
    log('webhook_rejected', { provider: 'SEPAY' });
    return json(401, { error: 'unauthorized' });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const parsed = parseSepay(body);
  if (parsed.kind === 'ignore') return new Response(SEPAY_ACK, { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (parsed.kind === 'invalid') {
    log('webhook_invalid', { provider: 'SEPAY', reason: parsed.reason });
    return json(400, { error: 'invalid_payload' });
  }
  const t = parsed.txn;
  const db = serviceClient();

  // Chọn tài khoản nhận: tài khoản ảo (nếu đã đăng ký) trước, rồi tài khoản chính
  let accountNo = t.accountCandidates[t.accountCandidates.length - 1]!;
  if (t.bankBin && t.accountCandidates.length > 1) {
    const { data } = await db
      .from('payment_accounts')
      .select('account_no')
      .eq('bank_bin', t.bankBin)
      .in('account_no', t.accountCandidates)
      .eq('is_active', true);
    const known = new Set((data ?? []).map((r: { account_no: string }) => r.account_no));
    accountNo = t.accountCandidates.find((a) => known.has(a)) ?? accountNo;
  }

  const { data, error } = await db.rpc('confirm_payment', {
    p_provider: t.provider,
    p_txn_id: t.txnId,
    p_amount: t.amount,
    p_content: t.content,
    p_bank_bin: t.bankBin,
    p_account_no: accountNo,
    p_raw: body,
  });
  if (error) {
    log('confirm_payment_failed', { provider: 'SEPAY', txn: t.txnId, code: error.code ?? null });
    return json(500, { error: 'db' });   // cổng sẽ gửi lại
  }
  const row = Array.isArray(data) ? data[0] : data;
  log('payment_confirmed', { provider: 'SEPAY', txn: t.txnId, status: row?.match_status ?? null, amount: t.amount });
  return new Response(SEPAY_ACK, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
