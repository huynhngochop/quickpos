# Xuất app QuickPOS cho Android và iOS

Có 3 cách. Cách 1 dễ nhất: build trên máy chủ của Expo (EAS), không cần Android Studio hay máy Mac.

| Muốn có | File | Cần tài khoản | Cách |
| --- | --- | --- | --- |
| Cài thử trên điện thoại Android | `.apk` | Expo (miễn phí) | 1 hoặc 3 |
| Cài thử trên iPhone | bản "internal" | Expo + **Apple Developer (99 USD/năm)** | 1 |
| Chạy trên iOS Simulator (máy Mac) | `.app` | Expo, hoặc không cần nếu dùng cách 3 | 1 hoặc 3 |
| Lên Google Play | `.aab` | Expo + Google Play Console (25 USD một lần) | 1 |
| Lên App Store / TestFlight | `.ipa` | Expo + Apple Developer | 1 |

iPhone không cài được file tải từ ngoài như Android: muốn chạy trên iPhone thật thì bắt buộc có Apple Developer.

## Chuẩn bị (một lần)

```bash
npm run setup                     # cài thư viện
npm install -g eas-cli
eas login                         # tài khoản expo.dev
eas init                          # tạo project trên Expo, ghi projectId vào app.json
```

Đặt biến môi trường cho bản build (app chỉ cần URL và anon key — không đặt khóa bí mật nào ở đây):

```bash
for ENVNAME in preview production; do
  eas env:create --environment $ENVNAME --name EXPO_PUBLIC_SUPABASE_URL      --value https://<project>.supabase.co --visibility plaintext
  eas env:create --environment $ENVNAME --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key>                   --visibility plaintext
  eas env:create --environment $ENVNAME --name EXPO_PUBLIC_SUPPORT_PHONE     --value <hotline>                    --visibility plaintext
  eas env:create --environment $ENVNAME --name EXPO_PUBLIC_POLICY_URL        --value <link chính sách>            --visibility plaintext
  eas env:create --environment $ENVNAME --name EXPO_PUBLIC_EAS_PROJECT_ID    --value <projectId vừa tạo>          --visibility plaintext
done
```

## Cách 1 — Build trên Expo (khuyên dùng)

```bash
# Android: file .apk cài thẳng, gửi link cho chủ quán thử
eas build --platform android --profile preview

# iOS Simulator (không cần Apple Developer)
eas build --platform ios --profile simulator

# iPhone thật: đăng ký máy thử trước, rồi build (EAS tự tạo chứng chỉ, hỏi đăng nhập Apple)
eas device:create
eas build --platform ios --profile preview

# Bản lên store
eas build --platform all --profile production
eas submit --platform android     # lên Google Play, track "internal"
eas submit --platform ios         # lên TestFlight
```

Xong mỗi lệnh, EAS in đường link tải file và mã QR — quét bằng điện thoại để cài.

## Cách 2 — Build trên máy của bạn

```bash
npx expo run:android --variant release     # cần Android Studio + JDK 17
npx expo run:ios --configuration Release   # cần máy Mac + Xcode
```

## Cách 3 — GitHub Actions (đẩy code lên GitHub là có file)

File `.github/workflows/build-apps.yml`. Đặt secrets `EXPO_PUBLIC_*` trong Settings → Secrets → Actions, rồi vào
tab **Actions → Build apps → Run workflow**. Kết quả tải ở mục Artifacts:

- `QuickPOS-android-apk` — `.apk` ký bằng khóa thử (cài được, không lên Google Play được)
- `QuickPOS-ios-simulator` — `.app` cho Simulator
- Chọn "store" + secret `EXPO_TOKEN` → build `.aab` + `.ipa` trên Expo như cách 1

## Trước khi phát hành thật

- [ ] Biểu tượng: `assets/images/*` sinh từ `scripts/make-icons.mjs` — thay nếu có logo chính thức.
- [ ] `vn.quickpos.app` (Android package / iOS bundle id) là tên tạm: đổi trước lần lên store đầu tiên, sau đó không đổi được.
- [ ] Trang chính sách dữ liệu (`EXPO_PUBLIC_POLICY_URL`) và mục "Xóa tài khoản" — Google Play và App Store đều kiểm tra.
- [ ] Google Play: khai báo dữ liệu thu thập (Data safety); quyền `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` cần giải thích lý do (báo tiền khi tắt màn hình).
- [ ] Thông báo đẩy: iOS cần APNs key (EAS hỏi khi build). Android cần dự án Firebase: tải `google-services.json`, khai báo `"googleServicesFile": "./google-services.json"` trong `app.json` → `android`, và tải khóa FCM V1 lên bằng `eas credentials`. Thiếu bước này app vẫn chạy, chỉ không báo được khi tắt màn hình.
- [ ] Thử trên máy Android tầm thấp, chữ hệ thống lớn nhất, mạng chậm (CLAUDE.md).
