// Cấu hình Gradle cho bản Android (giữ được khi chạy `expo prebuild`).
// Kotlin 2.2: thư viện quảng cáo Google (play-services-ads 25.x) được biên dịch bằng Kotlin 2.3,
// trình biên dịch Kotlin 2.1 mặc định không đọc được; Kotlin 2.2 đọc được (tương thích tới bản kế tiếp).
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = {
  'android.kotlinVersion': '2.2.20',
};

module.exports = function withAndroidBuildTweaks(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const existing = cfg.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
