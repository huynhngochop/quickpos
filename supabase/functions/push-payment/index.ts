// push-payment — gọi bởi Database Webhook (bảng orders, sự kiện UPDATE).
// Gửi thông báo đẩy ưu tiên cao tới ĐÚNG máy tạo đơn khi tiền về, để app ở nền vẫn báo.
// Cấu hình webhook trong Supabase: thêm header `x-webhook-secret: <PUSH_WEBHOOK_SECRET>`.
// Gửi qua Expo Push Service (app dùng expo-notifications, getExpoPushTokenAsync).
// Deploy: supabase functions deploy push-payment --no-verify-jwt
import { decidePush, type DbWebhook } from '../_shared/push.ts';
import { env, json, log, serviceClient, timingSafeEqual } from '../_shared/http.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!timingSafeEqual(req.headers.get('x-webhook-secret') ?? '', env('PUSH_WEBHOOK_SECRET'))) {
    return json(401, { error: 'unauthorized' });
  }
  const evt = (await req.json()) as DbWebhook;
  const decision = decidePush(evt);
  if (!decision) return json(200, { sent: 0 });

  const { data: device } = await serviceClient()
    .from('device_registrations')
    .select('push_token')
    .eq('device_id', decision.deviceId)
    .maybeSingle();
  if (!device?.push_token) {
    log('push_no_token');
    return json(200, { sent: 0 });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (expoToken) headers.Authorization = `Bearer ${expoToken}`;

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify([
      {
        to: device.push_token,
        title: decision.title,
        body: decision.body,
        sound: 'default',
        priority: 'high',
        channelId: 'payments',   // app tạo kênh Android "payments" mức MAX
        data: { kind: 'payment' },
      },
    ]),
  });
  log('push_sent', { status: res.status });
  // Trả 200 dù Expo lỗi: không để Database Webhook gửi lại làm báo trùng
  return json(200, { sent: res.ok ? 1 : 0 });
});
