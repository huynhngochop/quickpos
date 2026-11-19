// Ghi mã ứng dụng AdMob vào app.json trước khi build (thư viện quảng cáo đọc thẳng khóa
// "react-native-google-mobile-ads" ở gốc app.json). Không có biến môi trường thì giữ mã mẫu của Google
// (bắt buộc phải có mã, thiếu thì app Android văng lúc mở; quảng cáo chỉ hiện khi có mã vùng quảng cáo thật).
//   ADMOB_ANDROID_APP_ID=ca-app-pub-...~... ADMOB_IOS_APP_ID=ca-app-pub-...~... node scripts/set-admob-ids.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../app.json', import.meta.url);
const config = JSON.parse(readFileSync(file, 'utf8'));
const ads = config['react-native-google-mobile-ads'];
if (process.env.ADMOB_ANDROID_APP_ID) ads.android_app_id = process.env.ADMOB_ANDROID_APP_ID;
if (process.env.ADMOB_IOS_APP_ID) ads.ios_app_id = process.env.ADMOB_IOS_APP_ID;
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log('AdMob:', process.env.ADMOB_ANDROID_APP_ID ? 'mã thật' : 'mã mẫu của Google');
