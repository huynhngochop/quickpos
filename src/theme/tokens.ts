/**
 * Quy chuẩn giao diện (canvas thiết kế, bảng 5.1). Component chỉ lấy số ở đây, không dùng số lẻ.
 * Người dùng chính 55–70 tuổi: chữ thân ≥ 18, số tiền ≥ 32, vùng bấm ≥ 56dp.
 */
export const colors = {
  ground: '#FBFAF7',
  surface: '#FFFFFF',
  ink: '#16191D',
  secondary: '#4A5058',
  border: '#D8D6CF',
  divider: '#E7E5DF',
  disabledBg: '#E7E5DF',
  primary: '#1D4ED8',
  primaryPressed: '#1E3A8A',
  primarySoft: '#EEF3FF',
  primaryMuted: '#93B4F5',
  success: '#0B6B35',
  successText: '#0B5A2C',
  successSoft: '#EAF7EE',
  warn: '#B54708',
  warnText: '#7A2E04',
  warnSoft: '#FFF4E5',
  danger: '#A3260F',
  dangerSoft: '#FDECEA',
  toggleOff: '#8A8F96',
  onColor: '#FFFFFF',
} as const;

export const font = {
  family: {
    regular: 'BeVietnamPro_400Regular',
    medium: 'BeVietnamPro_600SemiBold',
    bold: 'BeVietnamPro_700Bold',
    heavy: 'BeVietnamPro_800ExtraBold',
  },
  /** Cỡ chữ (dp). "caption" chỉ cho chú thích phụ, không cho nội dung chính. */
  size: {
    caption: 15,
    small: 16,
    body: 18,
    bodyLarge: 19,
    button: 20,
    title: 22,
    heading: 28,
    amount: 48,
    amountCompact: 40,
    amountSmall: 32,
  },
  /** Số tiền cỡ lớn không phóng quá 1.3 lần theo chữ lớn hệ thống (CLAUDE.md). */
  amountMaxScale: 1.3,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  gutter: 20,
} as const;

export const radius = {
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  pill: 999,
} as const;

export const touch = {
  min: 56,
  primary: 68,
  key: 64,
  keyCompact: 56,
  gapMin: 12,
} as const;

/** Thời gian màn hình xanh khi tiền về (ít nhất 3 giây). */
export const PAID_FLASH_MS = 3000;
