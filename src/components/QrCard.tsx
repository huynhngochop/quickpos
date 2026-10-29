import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors, radius, space } from '../theme/tokens';
import { Txt } from './Txt';
import { Loading, ErrorView } from './States';
import type { QrForOrder } from '../types/api';
import { vi } from '../i18n/vi';

/** Mã QR nền trắng, viền rộng để máy quét ngân hàng đọc nhanh. Không vắt qua nếp gập (size do layout tính). */
export function QrCard({
  qr,
  loading,
  error,
  onRetry,
  size,
}: {
  qr: QrForOrder | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  size: number;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.xl,
        borderWidth: 2,
        borderColor: colors.border,
        padding: space.lg,
        alignItems: 'center',
        gap: space.sm,
        alignSelf: 'center',
        width: size + space.lg * 2 + 4,
      }}
    >
      {loading ? (
        <View style={{ width: size, height: size, justifyContent: 'center' }}>
          <Loading label={vi.sale.qrLoading} />
        </View>
      ) : error ? (
        <ErrorView error={error} onRetry={onRetry} />
      ) : qr ? (
        <>
          <View accessible accessibilityLabel={vi.sale.scanToPay}>
            <QRCode value={qr.qr_payload} size={size} ecl="M" quietZone={8} backgroundColor="#FFFFFF" color="#000000" />
          </View>
          <Txt variant="bodyStrong" center>
            {qr.account_name ? `${qr.bank_name} · ${qr.account_name}` : qr.bank_name}
          </Txt>
          {qr.uses_order_code ? (
            <Txt variant="small" tone="secondary" center>
              {vi.sale.qrFallbackNote(qr.order_code)}
            </Txt>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
