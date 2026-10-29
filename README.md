# QuickPOS — thu tiền VietQR cho quán nhỏ

App Expo (Android/iOS) + Supabase. Đọc `CLAUDE.md` trước khi sửa code, `docs/api.md` cho mọi lời gọi backend.

## Chạy lần đầu

```bash
npm run setup                 # cài thư viện (Expo SDK 57, expo install chọn đúng phiên bản)
cp .env.example .env          # điền URL + anon key Supabase, số hotline
supabase start && supabase db reset
npm run test:db               # 112 kiểm thử SQL: RLS, đối soát, đánh số hóa đơn, hàm v1
npm test                      # 19 nhóm test logic: đọc số, bố cục, hàng đợi, PIN, VietQR, SePay
npx tsc --noEmit
npx expo run:android          # cần bản build thật để có thông báo đẩy (Expo Go không đủ)
```

Xuất file cài đặt Android (.apk/.aab) và iOS: xem `docs/build.md`.

Edge Functions:

```bash
supabase secrets set SEPAY_WEBHOOK_SECRET=... PUSH_WEBHOOK_SECRET=... CRON_SECRET=...
supabase functions deploy qr-for-order
supabase functions deploy payment-webhook --no-verify-jwt          # URL cho SePay: …/payment-webhook/sepay
supabase functions deploy push-payment --no-verify-jwt             # Database Webhook: orders UPDATE, header x-webhook-secret
supabase functions deploy process-account-deletion --no-verify-jwt # pg_cron hằng ngày, header x-cron-secret
```

## Màn hình ↔ file (canvas thiết kế)

| Canvas | File |
| --- | --- |
| 1.1 Đăng nhập · 1.2 Mã OTP | `app/dang-nhap.tsx`, `app/ma-otp.tsx` |
| 7.1 Đồng ý dữ liệu | `app/dong-y.tsx` |
| Cài đặt ban đầu 1/3, 2/3, 3/3 | `app/thiet-lap/quan.tsx`, `tai-khoan.tsx`, `pin.tsx` |
| 2.1 Trang chính | `app/trang-chinh.tsx` |
| 2.2 Nhập số tiền (+ 6.1, 6.4, 6.5, 6.6) | `app/thu-tien.tsx` — một cột / hai cột theo `layoutFor()` |
| 2.3–2.6, 7.4 Chờ tiền, đã nhận, thiếu, dư, ngân hàng chậm | `src/features/sale/PaymentPanel.tsx`, `app/cho-tien/[id].tsx` |
| 2.7 Tiền mặt · 2.8 Mất mạng | `app/tien-mat.tsx`, `OfflineBanner`, `src/features/offline/` |
| 3.1 Sổ (+ 6.7) | `app/so.tsx` |
| 3.2 Tiền cần xem lại · 3.3 Gán đơn | `app/xem-lai.tsx`, `app/gan-don/[eventId].tsx` |
| 4.1 PIN · 4.2 Cài đặt · 4.3 Nhân viên | `app/nhap-pin.tsx`, `app/cai-dat.tsx`, `app/nhan-vien.tsx` |
| 7.2 Báo khi tắt màn hình · 7.3 Cập nhật · 7.5 Hết phiên · 7.6 Xóa tài khoản | `app/pin-nen.tsx`, `app/cap-nhat.tsx`, `app/het-phien.tsx`, `app/xoa-tai-khoan.tsx` |
| Màn hình xanh khi tiền về | `src/components/PaidFlash.tsx` |

## Còn thiếu (cần quyết định hoặc tài liệu bên ngoài)

- **Kết nối tài khoản nhận tiền** qua cổng (SePay/PayOS): cần tài liệu sandbox. Hiện chỉ hiện trạng thái; nhân viên ghi `payment_accounts` bằng tay phía server.
- **Tài khoản ảo theo đơn** trong `qr-for-order`, **webhook PayOS**: để TODO, không đoán định dạng.
- **Nhân viên**: mời thu ngân bằng số điện thoại, tên hiển thị, "Người bán" trên máy dùng chung — cần API mới.
- **Ghi lại cách xử lý tiền khách chuyển dư** (đã trả lại / khách cho): cần cột hoặc bảng mới.
- **Hóa đơn điện tử** (3.4): giai đoạn 2.
- `src/types/database.ts`: sinh bằng `npm run gen:types` rồi đổi `createClient` sang `createClient<Database>`.
