// Cấu hình Expo động: lấy app.json rồi gắn mã ứng dụng AdMob theo biến môi trường của bản build.
// Chưa có mã thật thì dùng mã ứng dụng mẫu của Google (bắt buộc phải có, thiếu thì app Android văng lúc mở).
// Vùng quảng cáo chỉ hiện khi có mã vùng quảng cáo thật (EXPO_PUBLIC_ADMOB_BANNER_*), xem src/features/ads/AdBanner.tsx.
const GOOGLE_SAMPLE_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const GOOGLE_SAMPLE_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    [
      'react-native-google-mobile-ads',
      {
        androidAppId: process.env.ADMOB_ANDROID_APP_ID || GOOGLE_SAMPLE_ANDROID_APP_ID,
        iosAppId: process.env.ADMOB_IOS_APP_ID || GOOGLE_SAMPLE_IOS_APP_ID,
      },
    ],
  ],
});
