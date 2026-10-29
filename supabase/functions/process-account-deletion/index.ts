// process-account-deletion — chạy hằng ngày (pg_cron + pg_net gọi kèm header x-cron-secret).
// Xử lý yêu cầu xóa đã quá 7 ngày (khoảng thời gian để người dùng gọi hỗ trợ hủy):
//  - Xóa người dùng khỏi Auth. Khóa ngoại (migration 5) tự đặt "người tạo/người bấm" về NULL trên đơn,
//    hóa đơn, bút toán — chứng từ kế toán của hộ vẫn giữ. Thiết bị, đồng ý, thành viên bị xóa theo.
//  - Chủ hộ còn quán: KHÔNG xóa tự động (businesses.owner_id = restrict); để hỗ trợ giao quán hoặc đóng quán.
// Deploy: supabase functions deploy process-account-deletion --no-verify-jwt
import { env, json, log, serviceClient, timingSafeEqual } from '../_shared/http.ts';

const GRACE_DAYS = 7;
const BATCH = 50;

Deno.serve(async (req) => {
  if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', env('CRON_SECRET'))) {
    return json(401, { error: 'unauthorized' });
  }
  const db = serviceClient();
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000).toISOString();
  const { data: due, error } = await db
    .from('account_deletion_requests')
    .select('user_id')
    .eq('status', 'REQUESTED')
    .lt('requested_at', cutoff)
    .limit(BATCH);
  if (error) return json(500, { error: 'db' });

  let deleted = 0;
  let ownersSkipped = 0;
  let failed = 0;
  for (const { user_id } of due ?? []) {
    const { count } = await db.from('businesses').select('id', { count: 'exact', head: true }).eq('owner_id', user_id);
    if ((count ?? 0) > 0) {
      ownersSkipped++;
      continue;
    }
    await db.from('account_deletion_requests').update({ status: 'PROCESSING' }).eq('user_id', user_id);
    const { error: delErr } = await db.auth.admin.deleteUser(user_id);
    if (delErr) {
      failed++;
      await db.from('account_deletion_requests').update({ status: 'REQUESTED' }).eq('user_id', user_id);
    } else {
      deleted++;   // dòng yêu cầu tự mất theo (on delete cascade)
    }
  }
  log('account_deletion_run', { deleted, owners_skipped: ownersSkipped, failed });
  return json(200, { deleted, owners_skipped: ownersSkipped, failed });
});
