import Constants from 'expo-constants';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Expo chỉ nhúng biến EXPO_PUBLIC_* khi viết thẳng tên (không đọc động process.env[name])
export const ENV = {
  /** Bản build thiếu máy chủ (APK xem thử): app mở được, cổng vào báo chưa cấu hình thay vì văng */
  configured: url.length > 0 && anonKey.length > 0,
  /** Không có máy chủ → dữ liệu nằm trên máy (src/lib/localEngine.ts) */
  demo: !(url.length > 0 && anonKey.length > 0),
  /** Không máy chủ + có dữ liệu mẫu, giả lập khách chuyển khoản (QA, xem thử). Bản phát hành đặt EXPO_PUBLIC_DEMO_SAMPLE=0 */
  sample: !(url.length > 0 && anonKey.length > 0) && process.env.EXPO_PUBLIC_DEMO_SAMPLE !== '0',
  /** Không máy chủ, dữ liệu thật của quán chỉ nằm trên máy này (cần sao lưu ra file) */
  localOnly: !(url.length > 0 && anonKey.length > 0) && process.env.EXPO_PUBLIC_DEMO_SAMPLE === '0',
  supabaseUrl: url || 'https://not-configured.invalid',
  supabaseAnonKey: anonKey || 'not-configured',
  supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '',
  /**
   * Cách bán gói Pro: 'store' = thuê bao qua App Store / Google Play (bản trên cửa hàng, mặc định);
   * 'code' = chuyển khoản rồi nhập mã kích hoạt (chỉ bản APK cài ngoài cửa hàng — cửa hàng cấm cách này).
   */
  billing: (process.env.EXPO_PUBLIC_BILLING === 'code' ? 'code' : 'store') as 'store' | 'code',
  /** Mã sản phẩm thuê bao năm trên App Store Connect / Google Play Console */
  proStoreSku: process.env.EXPO_PUBLIC_PRO_STORE_SKU ?? 'quickpos_pro_year',
  /** Gói Pro: giá một năm (đồng) và tài khoản nhận tiền của người bán (bản dùng mã kích hoạt) */
  proPriceYear: Number(process.env.EXPO_PUBLIC_PRO_PRICE_YEAR ?? 599000) || 599000,
  vendorBankBin: process.env.EXPO_PUBLIC_VENDOR_BANK_BIN ?? '',
  vendorAccountNo: process.env.EXPO_PUBLIC_VENDOR_ACCOUNT_NO ?? '',
  vendorAccountName: process.env.EXPO_PUBLIC_VENDOR_ACCOUNT_NAME ?? '',
  vendorZalo: process.env.EXPO_PUBLIC_VENDOR_ZALO ?? '',
  policyUrl: process.env.EXPO_PUBLIC_POLICY_URL ?? '',
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  policyVersion: String((Constants.expoConfig?.extra as { policyVersion?: string } | undefined)?.policyVersion ?? '2026-10-29'),
} as const;
