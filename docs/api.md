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
| `add_expense_v1` | Thành viên hộ | `p_entry_id uuid` (app sinh), `p_business_id`, `p_amount bigint`, `p_category` (1–50 ký tự), `p_note`, `p_entry_date` = hôm nay (≤ 62 ngày trước, không ở tương lai) | Một dòng `journal_entries` (EXPENSE, MANUAL, `source_id = p_entry_id`) | Có (theo `p_entry_id`) | `QP_UNAUTHENTICATED`, `QP_FORBIDDEN`, `QP_INVALID_INPUT` | 3.5 Chi tiêu |
| `void_expense_v1` | OWNER, MANAGER | `p_business_id`, `p_entry_id` | Dòng đã đánh dấu `voided_at` (không xóa) | Có | `QP_NOT_FOUND`, `QP_FORBIDDEN` | 3.5 → "Ghi nhầm" |
| `add_debt_customer_v1` | Thành viên hộ | `p_customer_id uuid` (app sinh), `p_business_id`, `p_name` (1–100), `p_phone` (`0` + 9 số, có thể trống), `p_phone_consent boolean` | Một dòng `debt_customers` | Có | `QP_FORBIDDEN`, `QP_INVALID_INPUT`, `QP_CONSENT_REQUIRED` (có số điện thoại mà khách chưa đồng ý) | 3.6 Sổ nợ → "Thêm khách nợ" |
| `record_debt_v1` | Thành viên hộ | `p_entry_id uuid` (app sinh), `p_customer_id`, `p_kind 'DEBT'\|'PAYMENT'`, `p_amount`, `p_note` | Một dòng `debt_entries` | Có | `QP_NOT_FOUND`, `QP_INVALID_INPUT`, `QP_PAYMENT_EXCEEDS_DEBT` | 3.7 Khách nợ |
| `void_debt_entry_v1` | OWNER, MANAGER | `p_entry_id` | Dòng đã đánh dấu `voided_at` | Có | `QP_NOT_FOUND`, `QP_FORBIDDEN` | 3.7 → "Ghi nhầm" |
| `update_tax_settings_v1` | OWNER, MANAGER | `p_business_id`, `p_tax_industry 'GOODS'\|'PRODUCTION'\|'SERVICE'\|'LEASING'\|'OTHER'` | Một dòng `businesses` | Có | `QP_FORBIDDEN`, `QP_INVALID_INPUT` | 5.1 Thuế → "Ngành nghề" |
| `upsert_product_v1` | OWNER, MANAGER | `p_product_id` (app sinh), `p_business_id`, `p_name`, `p_price`, `p_unit`, `p_category`, `p_cost_price`, `p_track_stock`, `p_low_stock_at` | Một dòng `products` | Có (cùng mã = sửa) | `QP_FORBIDDEN`, `QP_INVALID_INPUT` | 6.1 Hàng hóa, 6.2 Sửa món |
| `set_product_active_v1` | OWNER, MANAGER | `p_product_id`, `p_active` | Một dòng `products` | Có | `QP_NOT_FOUND`, `QP_FORBIDDEN` | 6.2 Ngừng bán / bán lại |
| `stock_in_v1` | Thành viên hộ | `p_movement_id` (app sinh), `p_product_id`, `p_qty > 0`, `p_unit_cost`, `p_note`, `p_record_expense` (ghi luôn chi "Nhập hàng") | Một dòng `products` (tồn mới) | Có | `QP_NOT_FOUND`, `QP_INVALID_INPUT` | 6.2 Nhập hàng |
| `stock_count_v1` | OWNER, MANAGER | `p_movement_id`, `p_product_id`, `p_actual_qty ≥ 0`, `p_note` | Một dòng `products` | Có | `QP_NOT_FOUND`, `QP_FORBIDDEN`, `QP_INVALID_INPUT` | 6.2 Kiểm kho |
| `open_shift_v1` | Thành viên hộ | `p_shift_id` (app sinh), `p_business_id`, `p_opening_cash` | Một dòng `cash_shifts` (đang có ca mở thì trả ca đó) | Có | `QP_FORBIDDEN`, `QP_INVALID_INPUT` | 7.3 Ca bán |
| `close_shift_v1` | Thành viên hộ | `p_shift_id`, `p_counted_cash`, `p_note` | Một dòng `cash_shifts` (chốt bán/chi/tiền phải có) | Có | `QP_NOT_FOUND`, `QP_INVALID_INPUT` | 7.3 |
| `invite_member_v1` | OWNER | `p_invite_id` (app sinh), `p_business_id`, `p_phone` (`0` + 9 số), `p_role 'MANAGER'\|'CASHIER'\|'ACCOUNTANT'` | Một dòng `business_invites` | Có (mời lại = đổi quyền) | `QP_FORBIDDEN`, `QP_INVALID_INPUT`, `QP_ALREADY_MEMBER` | 4.3 Nhân viên |
| `revoke_invite_v1` | OWNER | `p_invite_id` | Một dòng `business_invites` | Có | `QP_NOT_FOUND` | 4.3 |
| `accept_invites_v1` | Người đã đăng nhập | — | Số quán vừa vào | Có | `QP_UNAUTHENTICATED` | Mở app (trước khi đọc quán) |
| `set_member_role_v1` / `remove_member_v1` | OWNER | `p_business_id`, `p_user_id`, (`p_role`) | — | Có | `QP_FORBIDDEN`, `QP_NOT_FOUND` (kể cả khi nhắm vào chủ quán) | 4.3 |
| `upsert_customer_v1` | Thành viên hộ | `p_customer_id` (app sinh), `p_business_id`, `p_name`, `p_phone`, `p_consent` | Một dòng `crm_customers` | Có | `QP_INVALID_INPUT`, `QP_CONSENT_REQUIRED`, `QP_PHONE_TAKEN` | 7.1 Khách quen |
| `set_order_customer_v1` | Thành viên hộ | `p_order_id`, `p_customer_id` | Một dòng `orders` (đơn đã trả → cộng điểm ngay) | Có | `QP_NOT_FOUND`, `QP_ALREADY_ASSIGNED` | 2.2 Thu tiền, 2.7, 3.8 |
| `redeem_points_v1` | Thành viên hộ | `p_event_id` (app sinh), `p_customer_id`, `p_points`, `p_note` | Một dòng `crm_customers` | Có | `QP_NOT_FOUND`, `QP_INVALID_INPUT`, `QP_NOT_ENOUGH_POINTS` | 7.2 |
| `update_loyalty_settings_v1` | OWNER, MANAGER | `p_business_id`, `p_vnd_per_point` (0 = tắt) | Một dòng `businesses` | Có | `QP_FORBIDDEN`, `QP_INVALID_INPUT` | 7.2 |
| `create_debt_payment_order_v1` | Thành viên hộ | `p_order_id` (app sinh), `p_customer_id` (khách nợ), `p_amount ≤ số nợ`, `p_device_id` | Một dòng `orders` (VIETQR, "Trả nợ"); tiền về → server ghi dòng trả nợ | Có | `QP_NOT_FOUND`, `QP_INVALID_INPUT`, `QP_PAYMENT_EXCEEDS_DEBT` | 3.7 → "Thu nợ bằng mã QR" |
| `update_invoice_settings_v1` | OWNER, MANAGER | `p_business_id`, `p_provider 'NONE'\|'DEMO'\|'MISA'\|'VIETTEL'\|'VNPT'\|'OTHER'`, `p_form_no '1'\|'2'`, `p_symbol` (6 ký tự) | Một dòng `businesses` | Có | `QP_FORBIDDEN`, `QP_INVALID_INPUT` | 7.4 Hóa đơn điện tử |
| `create_invoice_from_order_v1` | Thành viên hộ | `p_invoice_id` (app sinh), `p_order_id` (đã trả), `p_buyer_name`, `p_buyer_tax_code`, `p_buyer_email`, `p_buyer_address` | Một dòng `invoices` (DRAFT, dòng hàng chép từ đơn) | Có (một đơn một hóa đơn) | `QP_NOT_FOUND`, `QP_ORDER_NOT_PAID`, `QP_EINVOICE_NOT_SETUP`, `QP_INVALID_INPUT` | 3.8 Chi tiết đơn |
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
| `from('business_members').select('role, business:businesses(id, business_name, tax_code, address, allow_cashier_manual_confirm, tax_industry, loyalty_vnd_per_point, einvoice_provider, invoice_form_no, invoice_symbol)').eq('user_id', …)` | — | Quán của người đăng nhập | Mở app |
| `from('business_members').select('user_id, role').eq('business_id', …)` | — | Danh sách nhân viên | 4.3 |
| `from('payment_accounts').select(…).eq('business_id', …).eq('kind','MAIN').eq('is_active', true)` | — | Chỉ đọc; ghi do server sau khi cổng xác minh | Cài đặt ban đầu bước 2, 4.2 |
| `from('payment_events').select('…, order:orders(order_code)')` | như dòng `payment_events` ở trên | Lấy kèm mã đơn để hiện "Khách chuyển 2 lần cho đơn …" | 3.2 |
| `from('orders').select().eq('business_id', …).eq('order_code', MÃ)` | mã 8 ký tự | Tìm đơn theo mã (unique `(business_id, order_code)`) | 3.3 |
| `from('daily_sales').select('business_id, sale_date, method, orders_count, amount').eq('business_id', …).gte('sale_date', kỳ trước từ).lte('sale_date', kỳ này đến)` | khoảng ngày gồm cả kỳ so sánh | Báo cáo và thuế tính trên dòng này, không cộng `orders` | 3.4 Báo cáo, 5.1 Thuế |
| `from('journal_entries').select('id, source_id, amount, category, description, entry_date, created_at').eq('business_id', …).eq('entry_type','EXPENSE').is('voided_at', null).gte('entry_date', …).lte('entry_date', …).order('entry_date', desc).limit(500)` | khoảng ngày | Index `(business_id, entry_date desc)` | 3.5 Chi tiêu, 3.4, 5.1 |
| `from('debt_balances').select('customer_id, business_id, name, phone, balance, last_entry_at').eq('business_id', …).order('balance', desc).limit(500)` | — | View chạy quyền người gọi (RLS hai bảng nợ) | 3.6 Sổ nợ, 2.1 |
| `from('debt_entries').select('id, customer_id, kind, amount, note, entry_date, created_at, voided_at').eq('customer_id', …).order('created_at', desc).limit(200)` | — | Gồm cả dòng đã hủy (hiện "Đã hủy") | 3.7 |
| `from('products').select('id, business_id, name, unit, price, category, cost_price, track_stock, stock_qty, low_stock_at, is_active').eq('business_id', …)[.eq('is_active', true)].order('sort_order').order('name').limit(500)` | — | Index `(business_id, sort_order, name) where is_active` | 2.8 Chọn món, 6.1 |
| `from('stock_movements').select('id, product_id, kind, qty, unit_cost, order_id, note, created_at').eq('product_id', …).order('created_at', desc).limit(50)` | — | Bán: tự trừ khi đơn đã trả (một lần mỗi đơn) | 6.2 |
| `from('orders').select('*').eq('id', …).single()` + `from('order_items').select('id, order_id, product_id, name, quantity, unit_price, line_amount').eq('order_id', …)` | — | Chi tiết đơn, biên nhận | 3.8 |
| `rpc('sales_by_hour', { p_business_id, p_from, p_to })`, `rpc('top_products', { p_business_id, p_from, p_to, p_limit })` | khoảng ≤ 93 ngày (dài hơn báo `QP_INVALID_INPUT`) | Chạy quyền người gọi (RLS); dùng index `(business_id, sold_at)` | 3.4 Báo cáo |
| `rpc('current_shift_v1', { p_business_id })` | — | 0 hoặc 1 dòng: ca đang mở + tiền mặt bán/chi tới hiện tại | 7.3, 7.0 |
| `from('cash_shifts').select(…).eq('business_id', …).order('opened_at', desc).limit(10)` | — | Các ca gần đây | 7.3 |
| `from('business_members').select('user_id, role, member_phone').eq('business_id', …)` | — | `member_phone` có khi vào quán bằng lời mời | 4.3 |
| `from('business_invites').select('id, phone, role, created_at, accepted_at, revoked_at').eq('business_id', …).is('accepted_at', null).is('revoked_at', null)` | — | Chỉ OWNER, MANAGER đọc được | 4.3 |
| `from('crm_customers').select('id, business_id, display_name, phone_number, points, total_spent, visits, last_visit_at').eq('business_id', …).order('last_visit_at', desc).limit(500)` | — | Khách quen | 7.1 |
| `from('loyalty_events').select('id, customer_id, order_id, kind, points, note, created_at').eq('customer_id', …).order('created_at', desc).limit(50)` | — | Lịch sử điểm | 7.2 |
| `from('invoices').select('id, business_id, order_id, form_no, symbol, invoice_no, status, buyer_name, buyer_tax_code, buyer_email, total_amount, issued_at, tax_authority_code, lookup_url').eq('order_id', …)` hoặc `.eq('business_id', …).limit(30)` | — | Hóa đơn của đơn / đã xuất gần đây | 3.8, 7.4 |

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
| `QP_CONSENT_REQUIRED` | Cần hỏi khách đồng ý trước khi lưu số điện thoại. | Hiện ô đánh dấu đồng ý |
| `QP_PAYMENT_EXCEEDS_DEBT` | Số tiền trả nhiều hơn số đang nợ. Kiểm tra lại số tiền. | Giữ màn hình, sửa số |
| `QP_ALREADY_MEMBER` | Số điện thoại này đã là nhân viên của quán. | Không thử lại |
| `QP_PHONE_TAKEN` | Số điện thoại này đã có khách khác dùng. | Tìm khách đã có |
| `QP_NOT_ENOUGH_POINTS` | Khách chưa đủ điểm để đổi. | Sửa số điểm |
| `QP_ORDER_NOT_PAID` | Đơn chưa trả tiền nên chưa xuất hóa đơn được. | — |
| `QP_EINVOICE_NOT_SETUP` | Chưa cài hóa đơn điện tử. Vào Việc khác → Hóa đơn điện tử. | Mở 7.4 |
| `QP_EINVOICE_PROVIDER_NOT_READY` (Edge Function) | Nhà cung cấp hóa đơn này chưa kết nối được. Gọi hỗ trợ để cài đặt. | Không thử lại |
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
| `issue-einvoice` | App | `{ invoice_id }` (nháp từ `create_invoice_from_order_v1`) | Dòng `invoices` đã phát hành | DEMO: cấp số bằng `issue_invoice()` + mã cơ quan thuế bản thử. MISA/Viettel/VNPT/khác: nhà cung cấp tự cấp số → `record_einvoice_result()` (service_role), KHÔNG gọi `issue_invoice()`. Adapter còn TODO (cần tài liệu sandbox + tài khoản kết nối) → `501 QP_EINVOICE_PROVIDER_NOT_READY`. |
| Send SMS Hook (tùy chọn) | Supabase Auth | `{ user, sms: { otp } }` | — | Chỉ khi gửi OTP qua kênh không có sẵn trong Supabase. |

Đã có bản `_v1` báo lỗi bằng mã cho xác nhận tay và gán tiền (migration 5). App không gọi bản cũ nữa. Còn lại: `issue_invoice` (giai đoạn 2).

Secrets: `SEPAY_WEBHOOK_SECRET` (HMAC) hoặc `SEPAY_API_KEY`, `PUSH_WEBHOOK_SECRET`, `CRON_SECRET`, `EXPO_ACCESS_TOKEN` (tùy chọn). Ba hàm `payment-webhook`, `push-payment`, `process-account-deletion` deploy với `--no-verify-jwt` và tự xác thực bằng secret.
