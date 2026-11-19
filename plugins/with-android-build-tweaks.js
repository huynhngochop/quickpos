// Cấu hình Gradle cho bản Android (giữ được khi chạy `expo prebuild`).
//
// Kotlin 2.2: thư viện quảng cáo Google (play-services-ads 25.x) được biên dịch bằng Kotlin 2.3,
// trình biên dịch Kotlin 2.1 mặc định không đọc được; Kotlin 2.2 đọc được (tương thích tới bản kế tiếp).
// Không lên 2.3: nhiều module của React Native / Expo chưa chạy với 2.3.
// Hai bước, vì `android.kotlinVersion` chỉ đổi KSP và các module Expo, không đổi Kotlin Gradle Plugin:
//   1. đặt android.kotlinVersion trong gradle.properties;
//   2. ghi rõ phiên bản cho dòng classpath của Kotlin Gradle Plugin trong android/build.gradle.
const { withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');

const KOTLIN_VERSION = '2.2.20';

function withKotlinProperty(config) {
  return withGradleProperties(config, (cfg) => {
    const existing = cfg.modResults.find((item) => item.type === 'property' && item.key === 'android.kotlinVersion');
    if (existing) existing.value = KOTLIN_VERSION;
    else cfg.modResults.push({ type: 'property', key: 'android.kotlinVersion', value: KOTLIN_VERSION });
    return cfg;
  });
}

function withKotlinGradlePlugin(config) {
  return withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /classpath\(?\s*['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin(:[^'"]*)?['"]\s*\)?/,
      `classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}")`,
    );
    return cfg;
  });
}

module.exports = function withAndroidBuildTweaks(config) {
  return withKotlinGradlePlugin(withKotlinProperty(config));
};
