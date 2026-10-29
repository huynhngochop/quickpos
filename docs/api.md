# Hợp đồng API QuickPOS — v1

Tài liệu này là nguồn sự thật cho mọi lời gọi giữa app và backend. App và AI code **không gọi gì ngoài danh sách dưới đây**.
Thêm hoặc đổi một lời gọi = sửa tài liệu này trong cùng PR với migration.

## 1. Quy ước chung

| Quy ước | Chi tiết |
| --- | --- |
| Backend | Supabase: Postgres (RLS bật trên mọi bảng), Auth, Realtime, Edge Functions. App dùng `@supabase/supabase-js` với anon key. |
| Ghi dữ liệu | **Chỉ qua hàm `*_v1`** (`supabase.rpc(...)`). App không có quyền insert/update `orders`, `order_items`. |
| Đọc dữ liệu | Qua hàm đọc (`list_orders`, `day_summary`) hoặc `select` trên bảng/view được liệt kê ở mục 4. Luôn lọc `business_id`. |
| Phiên bản | Đổi tham số hoặc kết quả = hàm `_v2` mới. Giữ `_v1` cho đến khi `app_config.min_version` vượt bản app cuối cùng còn gọi `_v1`. |
| Gửi lại an toàn | Mọi lệnh tạo dùng **mã do app sinh** (UUID v4) — gửi lại bao nhiêu lần cũng chỉ có một bản ghi. Không sinh mã mới khi thử lại. |
| Tiền | Số nguyên VND (`bigint` trong DB, `number` trong TS). Không gửi số thập phân. |
| Thời gian | `timestamptz` ISO 8601. Ngày nghiệp vụ (sổ, kỳ thuế) theo `Asia/Ho_Chi_Minh`. |
| Lỗi | Hàm v1 báo lỗi bằng mã ổn định trong `message` (`QP_...`). App tra mã → câu tiếng Việt ở mục 6. `detail` chỉ để ghi log. |
| Thời gian chờ | 10 giây mỗi lời gọi. Thử lại tối đa 3 lần (1 s, 3 s, 9 s) với **cùng tham số**; sau đó đưa vào hàng đợi trên máy. |

## 2. Trình tự khi mở app

1. `check_app_version_v1(platform, version)` — gọi được khi chưa đăng nhập. `must_update = true` → chỉ hiện màn hình "Cần cập nhật".
2. Phiên đăng nhập: Supabase Auth bằng số điện thoại + OTP (`signInWithOtp({ phone })`, `verifyOtp`). Kênh gửi OTP cấu hình phía server (nhà cung cấp SMS hoặc Send SMS Hook).
3. Chưa có dòng trong `user_consents` cho phiên bản chính sách hiện tại → màn hình "Đồng ý" → `record_consent_v1`.
4. `register_device_v1(device_id, business_id, platform, app_version, push_token)` — mỗi lần mở app và khi mã thông báo đẩy đổi.
5. Mở kênh Realtime của hộ (mục 5); gửi các đơn trong hàng đợi trên máy (mục 7).

## 3. Hàm ghi (RPC)

| Hàm | Ai gọi | Tham số | Trả về | Gửi lại an toàn | Lỗi có thể gặp | Màn hình |
| --- | --- | --- | --- | --- | --- | --- |
| `create_order_v1` | Thành viên hộ | `p_order_id uuid`, `p_business_id uuid`, `p_items jsonb`, `p_payment_method 'VIETQR'\|'CASH'` = VIETQR, `p_sold_at timestamptz` = now, `p_device_id text` | Một dòng `orders` | Có (theo `p_order_id`) | `QP_FORBIDDEN`, `QP_INVALID_INPUT`, `QP_INVALID_ITEMS`, `QP_ORDER_CONFLICT` | 2.2 Nhập số tiền → "Hiện mã QR" |
| `create_cash_sale_v1` | Thành viên hộ | như trên, không có `p_payment_method` | Một dòng `orders` (đã PAID) | Có | như trên | 2.7 Thu tiền mặt, đồng bộ đơn lúc mất mạng |
| `cancel_order_v1` | Thành viên hộ | `p_order_id` | Một dòng `orders` | Có | `QP_NOT_FOUND`, `QP_ORDER_NOT_CANCELLABLE` | 2.3 Chờ tiền → "Hủy đơn này" |
| `confirm_transfer_manually_v1` | OWNER, MANAGER, CASHIER (thu ngân chỉ khi hộ bật `allow_cashier_manual_confirm`) | `p_order_id`, `p_note` | Một dòng `orders` | Có (đơn đã PAID trả lại dòng cũ) | `QP_UNAUTHENTICATED`, `QP_NOT_FOUND`, `QP_FORBIDDEN`, `QP_ORDER_NOT_CONFIRMABLE`, `QP_INVALID_INPUT` | 2.3 → "Tôi đã thấy tiền về" |
| `assign_payment_event_v1` | OWNER, MANAGER | `p_event_id`, `p_order_id` | `match_status` | Không — gọi lần 2 báo `QP_ALREADY_ASSIGNED` | `QP_UNAUTHENTICATED`, `QP_NOT_FOUND`, `QP_FORBIDDEN`, `QP_ALREADY_ASSIGNED` | 3.3 Gán tiền vào đơn |
| `create_business_v1` | Người đã đăng nhập | `p_business_id uuid` (app sinh), `p_business_name`, `p_tax_code`, `p_address` | Một dòng `businesses` | Có (cùng mã + cùng chủ) | `QP_UNAUTHENTICATED`, `QP_INVALID_INPUT`, `QP_FORBIDDEN`, `QP_TAX_CODE_TAKEN` | Cài đặt ban đầu bước 1 |
| `update_business_settings_v1` | OWNER, MANAGER | `p_business_id`, `p_allow_cashier_manual_confirm` | Một dòng `businesses` | Có | `QP_UNAUTHENTICATED`, `QP_FORBIDDEN` | 4.2 Cài đặt |
| `register_device_v1` | Người đã đăng nhập | `p_device_id`, `p_business_id`, `p_platform`, `p_app_version`, `p_push_token`, `p_speak_payments` | Một dòng `device_registrations` | Có | `QP_UNAUTHENTICATED`, `QP_FORBIDDEN` | Mở app, 4.2 Cài đặt |
| `record_consent_v1` | Người đã đăng nhập | `p_policy_version`, `p_source` = 'app' | — | Có | `QP_UNAUTHENTICATED` | 1.0 Đồng ý dữ liệu |
| `request_account_deletion_v1` | Người đã đăng nhập | `p_reason` | Một dòng `account_deletion_requests` | Có | `QP_UNAUTHENTICATED` | 4.4 Xóa tài khoản |
| `issue_invoice` | OWNER, MANAGER, CASHIER | `p_invoice_id` | Một dòng `invoices` | Không | Câu tiếng Việt (mục 8) | Giai đoạn 2 |

`p_items` mẫu (màn hình nhập số tiền không có danh mục chỉ gửi một dòng):

```json
[{ "name": "Bán hàng", "quantity": 1, "unit_price": 18000 }]
[{ "name": "Cà phê sữa", "quantity": 2, "unit_price": 20000, "product_id": "…uuid…" }]
```

Ràng buộc: 1–200 dòng; `name` 1–200 ký tự; `0 < quantity ≤ 100000`; `0 ≤ unit_price ≤ 100 tỷ`; `product_id` (nếu có) phải thuộc hộ; đơn VIETQR phải > 0 đ.

Giờ bán: `p_sold_at` lệch quá 5 phút về tương lai hoặc quá 7 ngày về quá khứ **không bị từ chối** — server dùng giờ của mình, đặt `clock_suspect = true` và lưu giờ máy ở `client_sold_at`. App hiện "Giờ trên điện thoại chưa đúng" ở Sổ.

## 4. Đọc dữ liệu

| Lời gọi | Tham số / bộ lọc | Ghi chú | Màn hình |
| --- | --- | --- | --- |
| `rpc('day_summary', { p_business_id, p_day })` | ngày `YYYY-MM-DD` | Tối đa 3 dòng (VIETQR, CASH, CARD) | 2.1 Trang chính, 3.1 Sổ |
| `rpc('list_orders', { p_business_id, p_from, p_to, p_after_sold_at, p_after_id, p_limit })` | trang sau: truyền `sold_at`, `id` của dòng cuối trang trước | Tối đa 100 dòng/trang; mặc định 20. **Không dùng offset.** | 3.1 Sổ |
| `from('daily_sales').select().eq('business_id', …).gte('sale_date', …)` | khoảng ngày | Tổng tháng/năm: cộng các dòng này | 3.1 Sổ (tháng) |
| `from('payment_events').select().eq('business_id', …).in('match_status', ['UNMATCHED','PARTIAL','ALREADY_PAID']).order('received_at', desc).limit(20)` | — | Chỉ OWNER, MANAGER, ACCOUNTANT đọc được | 3.2 Tiền cần xem lại |
| `from('unreconciled_manual_confirmations').select().eq('business_id', …)` | — | Đơn xác nhận tay > 15 phút chưa có tiền | 3.2 |
| `from('orders').select().eq('business_id', …).eq('payment_status','UNPAID').eq('total_amount', x).order('created_at', desc).limit(5)` | số tiền | Dùng index riêng cho đơn chưa trả | 3.3 Gán đơn |
| `from('orders').select().eq('id', …).single()` | — | Hỏi lại trạng thái khi nối lại Realtime / mở lại màn hình | 2.3 |
| `rpc('check_app_version_v1', { p_platform, p_version })` | — | `{ must_update, should_update, latest_version, store_url }` | Mở app |
| `from('user_consents').select('policy_version').eq('user_id', …).eq('policy_version', …)` | — | Đã đồng ý phiên bản chính sách hiện tại chưa | Mở app |
| `from('business_members').select('role, business:businesses(id, business_name, tax_code, address, allow_cashier_manual_confirm)').eq('user_id', …)` | — | Quán của người đăng nhập | Mở app |
| `from('business_members').select('user_id, role').eq('business_id', …)` | — | Danh sách nhân viên | 4.3 |
| `from('payment_accounts').select(…).eq('business_id', …).eq('kind','MAIN').eq('is_active', true)` | — | Chỉ đọc; ghi do server sau khi cổng xác minh | Cài đặt ban đầu bước 2, 4.2 |
| `from('payment_events').select('…, order:orders(order_code)')` | như dòng `payment_events` ở trên | Lấy kèm mã đơn để hiện "Khách chuyển 2 lần cho đơn …" | 3.2 |
| `from('orders').select().eq('business_id', …).eq('order_code', MÃ)` | mã 8 ký tự | Tìm đơn theo mã (unique `(business_id, order_code)`) | 3.3 |

## 5. Realtime

- Kênh: `business:<business_id>` (một kênh cho mỗi hộ). Bản đầu dùng `postgres_changes` trên bảng `orders` lọc `business_id=eq.<id>`; khi số máy lớn chuyển sang Broadcast gửi từ trigger.
- Sự kiện quan tâm: đơn chuyển `payment_status` sang `PAID`, hoặc `amount_received` thay đổi.
- **Chỉ máy có `device_id = orders.created_device_id` đọc to và rung**, nếu `speak_payments` đang bật. Máy khác cập nhật im lặng.
- Realtime chỉ để cập nhật giao diện. Mất kết nối rồi nối lại, hoặc app trở lại từ nền: **luôn hỏi lại trạng thái đơn** (mục 4).
- App ở nền: Edge Function `push-payment` gửi thông báo đẩy ưu tiên cao đến `device_registrations.push_token` của máy tạo đơn.

## 6. Mã lỗi → câu cho người dùng

| Mã | Câu hiện trên màn hình | App làm gì |
| --- | --- | --- |
| `QP_UNAUTHENTICATED` | Phiên đăng nhập đã hết. Đăng nhập lại để tiếp tục. | Về màn hình đăng nhập, giữ hàng đợi |
| `QP_FORBIDDEN` | Tài khoản này không bán cho quán đó. Gọi chủ quán để kiểm tra. | Không thử lại |
| `QP_INVALID_INPUT` | Có thông tin chưa đúng. Thử lại hoặc gọi hỗ trợ. | Không thử lại; ghi log |
| `QP_INVALID_ITEMS` | Số tiền hoặc món hàng chưa đúng. Kiểm tra lại. | Không thử lại |
| `QP_ORDER_CONFLICT` | Đơn này đã được tạo trước đó. | Sinh mã đơn mới, tạo lại |
| `QP_NOT_FOUND` | Không tìm thấy đơn. | Tải lại danh sách |
| `QP_ORDER_NOT_CANCELLABLE` | Đơn đã nhận tiền nên không hủy được. Xem ở “Tiền cần xem lại”. | Mở màn hình 3.2 |
| `QP_ORDER_NOT_CONFIRMABLE` | Đơn này đã hủy hoặc đã hoàn tiền nên không xác nhận được. | Tải lại đơn |
| `QP_ALREADY_ASSIGNED` | Khoản tiền này đã được gán rồi. | Tải lại danh sách |
| `QP_TAX_CODE_TAKEN` | Mã số thuế này đã có quán khác dùng. Gọi hỗ trợ để kiểm tra. | Không thử lại |
| `QP_NO_PAYMENT_ACCOUNT` (Edge Function) | Chưa kết nối tài khoản nhận tiền. Thu tiền mặt hoặc gọi hỗ trợ. | Không thử lại |
| `QP_ORDER_NOT_PAYABLE` (Edge Function) | Đơn này đã trả hoặc đã hủy. | Tải lại đơn |
| Hết thời gian / mất mạng | Mất mạng. Đơn đã lưu, sẽ gửi khi có mạng. | Đưa vào hàng đợi (chỉ đơn tiền mặt) |
| Lỗi khác | Có lỗi, thử lại sau ít phút. | Ghi log kèm `detail` |

## 7. Hàng đợi trên máy (mất mạng)

- Chỉ **đơn tiền mặt** được tạo khi mất mạng. Mã QR cần mạng.
- Mỗi đơn chờ lưu trong SQLite trên máy: `order_id` (UUID sinh sẵn), `items`, `sold_at` (giờ máy), `device_id`, số lần thử.
- Khi có mạng: gửi lần lượt bằng `create_cash_sale_v1` với **đúng tham số đã lưu**. Thành công mới xóa khỏi hàng đợi.
- Sổ hôm nay = tổng từ server + đơn còn trong hàng đợi (ghi rõ "N đơn chờ gửi").
- Đăng xuất hoặc xóa tài khoản khi hàng đợi chưa trống → chặn và cảnh báo.

## 8. Edge Functions

Đã có code trong `supabase/functions/` (chưa chạy với sandbox cổng thật). Lỗi trả cho app: HTTP 4xx + `{ "error": "QP_..." }`.

| Tên | Gọi bởi | Vào | Ra | Ghi chú |
| --- | --- | --- | --- | --- |
| `payment-webhook/<provider>` | Cổng thanh toán | Webhook gốc của cổng | `200` ngay | Xác thực chữ ký/khóa API theo tài liệu cổng → chuẩn hóa → `confirm_payment(...)` bằng service_role. Thứ tự tham số `confirm_payment`: provider, mã giao dịch, số tiền, nội dung, bank_bin, **số tài khoản nhận**, payload. |
| `qr-for-order` | App | `{ order_id }` | `{ qr_payload, bank_name, account_name, amount, uses_order_code, order_code, expires_at }` | `amount` = phần còn thiếu. Bản hiện tại: QR tài khoản chính + mã đơn trong nội dung (`uses_order_code = true`). TODO: tài khoản ảo theo đơn qua API cổng. |
| `push-payment` | Database webhook khi đơn PAID | dòng `orders` | — | Gửi thông báo đẩy đến máy tạo đơn. |
| `process-account-deletion` | Lịch chạy hằng ngày | — | — | Xóa người dùng khỏi Auth, ẩn danh dữ liệu cá nhân; giữ chứng từ kế toán của hộ. |
| Send SMS Hook (tùy chọn) | Supabase Auth | `{ user, sms: { otp } }` | — | Chỉ khi gửi OTP qua kênh không có sẵn trong Supabase. |

Đã có bản `_v1` báo lỗi bằng mã cho xác nhận tay và gán tiền (migration 5). App không gọi bản cũ nữa. Còn lại: `issue_invoice` (giai đoạn 2).

Secrets: `SEPAY_WEBHOOK_SECRET` (HMAC) hoặc `SEPAY_API_KEY`, `PUSH_WEBHOOK_SECRET`, `CRON_SECRET`, `EXPO_ACCESS_TOKEN` (tùy chọn). Ba hàm `payment-webhook`, `push-payment`, `process-account-deletion` deploy với `--no-verify-jwt` và tự xác thực bằng secret.
