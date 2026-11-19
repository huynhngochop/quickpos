/**
 * Một vùng quảng cáo Google (AdMob) ở đầu trang chính, chỉ cho bản miễn phí.
 *
 * Không hiện khi:
 * - quán đang có gói Pro (kể cả dùng thử) hoặc đây là máy nhân viên (luôn thuộc gói Pro);
 * - chưa biết gói của quán (tránh quảng cáo nháy lên rồi biến mất);
 * - bản build không có mã vùng quảng cáo (EXPO_PUBLIC_ADMOB_BANNER_ANDROID / _IOS), ví dụ bản QA.
 *
 * Chỉ xin quảng cáo không cá nhân hóa: không dùng mã quảng cáo của máy để theo dõi người dùng, nên iOS không phải
 * hỏi quyền theo dõi (App Tracking Transparency) và phần khai báo quyền riêng tư trên cửa hàng đơn giản hơn.
 * Thư viện quảng cáo chỉ khởi động khi vùng này hiện lần đầu, để không làm chậm lúc mở app.
 */
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import mobileAds, { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { space } from '../../theme/tokens';

const BANNER_UNIT =
  Platform.OS === 'android'
    ? (process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID ?? '')
    : Platform.OS === 'ios'
      ? (process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS ?? '')
      : '';

/** Bản build này có cấu hình quảng cáo không */
export const adsConfigured = BANNER_UNIT.length > 0;

let starting: Promise<unknown> | null = null;
function startAds() {
  starting ??= mobileAds().initialize().catch(() => undefined);
  return starting;
}

export function AdBanner({ hidden }: { hidden: boolean }) {
  const [ready, setReady] = useState(false);
  const [noAd, setNoAd] = useState(false);

  useEffect(() => {
    if (hidden || !adsConfigured) return;
    let mounted = true;
    void startAds().then(() => mounted && setReady(true));
    return () => {
      mounted = false;
    };
  }, [hidden]);

  if (hidden || !adsConfigured || !ready || noAd) return null;
  return (
    // Cách nút Cài đặt / Thoát bên dưới một khoảng rộng để khỏi bấm nhầm vào quảng cáo
    <View style={{ alignItems: 'center', marginBottom: space.lg }}>
      <BannerAd
        unitId={BANNER_UNIT}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        // Không có quảng cáo để hiện (hoặc mất mạng): bỏ hẳn vùng này, không để khoảng trống
        onAdFailedToLoad={() => setNoAd(true)}
      />
    </View>
  );
}
