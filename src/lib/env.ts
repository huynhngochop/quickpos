import Constants from 'expo-constants';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Expo chỉ nhúng biến EXPO_PUBLIC_* khi viết thẳng tên (không đọc động process.env[name])
export const ENV = {
  /** Bản build thiếu máy chủ (APK xem thử): app mở được, cổng vào báo chưa cấu hình thay vì văng */
  configured: url.length > 0 && anonKey.length > 0,
  /** Không có máy chủ → dữ liệu nằm trên máy (src/lib/demoClient.ts) */
  demo: !(url.length > 0 && anonKey.length > 0),
  /** Không máy chủ + có dữ liệu mẫu, giả lập khách chuyển khoản (QA, xem thử). Bản phát hành đặt EXPO_PUBLIC_DEMO_SAMPLE=0 */
  sample: !(url.length > 0 && anonKey.length > 0) && process.env.EXPO_PUBLIC_DEMO_SAMPLE !== '0',
  /** Không máy chủ, dữ liệu thật của quán chỉ nằm trên máy này (cần sao lưu ra file) */
  localOnly: !(url.length > 0 && anonKey.length > 0) && process.env.EXPO_PUBLIC_DEMO_SAMPLE === '0',
  supabaseUrl: url || 'https://not-configured.invalid',
  supabaseAnonKey: anonKey || 'not-configured',
  supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '',
  policyUrl: process.env.EXPO_PUBLIC_POLICY_URL ?? '',
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  policyVersion: String((Constants.expoConfig?.extra as { policyVersion?: string } | undefined)?.policyVersion ?? '2026-10-29'),
} as const;
