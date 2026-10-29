// Tiện ích chung cho Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Lỗi trả cho app luôn là { error: 'QP_...' } — app tra mã → câu tiếng Việt (docs/api.md mục 6). */
export function qpError(status: number, code: string): Response {
  return json(status, { error: code });
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Thiếu biến môi trường ${name}`);
  return v;
}

/** Client quyền server — CHỈ dùng trong Edge Function, không bao giờ đưa key này vào app. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client mang JWT của người gọi → RLS áp dụng như trong app. */
export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Ghi log không chứa dữ liệu cá nhân: chỉ mã, trạng thái, số đếm. */
export function log(event: string, fields: Record<string, string | number | boolean | null> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}
