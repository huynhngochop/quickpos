/**
 * Chọn bố cục theo kích thước cửa sổ hiện tại (không theo loại máy) — canvas hàng 6.
 *   Rộng < 600, cao < 700 → "compact" (điện thoại nhỏ 360×640, màn ngoài máy gập)
 *   Rộng < 600            → "single"  (bản thiết kế 390×844)
 *   Rộng ≥ 600            → "split"   (máy gập mở, máy tính bảng, máy POS ngang)
 */
import { font, touch } from './tokens';

export type LayoutKind = 'compact' | 'single' | 'split';

export interface LayoutMetrics {
  kind: LayoutKind;
  /** Cao một phím số */
  keyHeight: number;
  /** Cỡ số tiền lớn (trước khi nhân cỡ chữ hệ thống) */
  amountSize: number;
  /** Nút phụ hiện thành liên kết chữ để đủ chỗ */
  secondaryAsLink: boolean;
  /** Bề rộng tối đa của cột nội dung (màn rộng không kéo nút dài hết màn) */
  maxColumnWidth: number;
  /** Chiều rộng mỗi cột khi chia đôi; một cột thì bằng chiều rộng cửa sổ */
  columnWidth: number;
  /** Cạnh mã QR, không vượt cột và không vắt qua nếp gập */
  qrSize: number;
  /** Điện thoại khóa dọc; màn lớn cho xoay */
  lockPortrait: boolean;
}

export const BREAKPOINT_WIDE = 600;
export const BREAKPOINT_SHORT = 700;
const GUTTER = 20;

export function layoutFor(width: number, height: number, fontScale = 1): LayoutMetrics {
  const wide = width >= BREAKPOINT_WIDE;
  // Chữ hệ thống rất lớn trên máy nhỏ: dùng bố cục gọn sớm hơn để bàn phím vẫn vừa màn hình
  const short = height < BREAKPOINT_SHORT || (fontScale >= 1.6 && height < 800);
  const kind: LayoutKind = wide ? 'split' : short ? 'compact' : 'single';

  const columnWidth = wide ? Math.floor((width - GUTTER * 3) / 2) : width - GUTTER * 2;
  // Màn ngang (máy tính bảng, máy POS): QR thấp hơn để cả nút "Tôi đã thấy tiền về" và "Hủy đơn này"
  // nằm trong màn hình (máy 1280×800: QR 216 dp, quét bằng điện thoại vẫn dễ)
  const qrLimitByHeight = Math.floor(height * (wide ? (width > height ? 0.27 : 0.6) : 0.42));
  const qrSize = Math.max(200, Math.min(columnWidth - 32, qrLimitByHeight, 360));

  return {
    kind,
    keyHeight: kind === 'compact' ? touch.keyCompact : touch.key,
    amountSize: kind === 'compact' ? font.size.amountCompact : font.size.amount,
    secondaryAsLink: kind === 'compact',
    maxColumnWidth: wide ? 560 : width,
    columnWidth,
    qrSize,
    lockPortrait: !wide,
  };
}
