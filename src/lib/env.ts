import Constants from 'expo-constants';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Expo chỉ nhúng biến EXPO_PUBLIC_* khi viết thẳng tên (không đọc động process.env[name])
export const ENV = {
  /** Bản build thiếu máy chủ (APK xem thử): app mở được, cổng vào báo chưa cấu hình thay vì văng */
  configured: url.length > 0 && anonKey.length > 0,
  /** Không có máy chủ → chạy chế độ dùng thử (src/lib/demoClient.ts) */
  demo: !(url.length > 0 && anonKey.length > 0),
  supabaseUrl: url || 'https://not-configured.invalid',
  supabaseAnonKey: anonKey || 'not-configured',
  supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '',
  policyUrl: process.env.EXPO_PUBLIC_POLICY_URL ?? '',
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  policyVersion: String((Constants.expoConfig?.extra as { policyVersion?: string } | undefined)?.policyVersion ?? '2026-10-29'),
} as const;
