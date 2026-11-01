# CLAUDE.md — Micro SaaS VN (POS + VietQR + Hóa đơn điện tử cho hộ kinh doanh)

Tệp này hướng dẫn Claude Code (và trợ lý AI khác) làm việc trong repo. Đọc hết trước khi sửa code.

## Sản phẩm

Ứng dụng di động cho hộ kinh doanh Việt Nam: bán hàng, nhận tiền qua VietQR có xác nhận tự động,
phát hành hóa đơn điện tử qua nhà cung cấp đã đăng ký, ghi sổ thu chi.
Người dùng là chủ hộ và thu ngân, thường dùng điện thoại Android tầm trung, mạng chập chờn.

## Stack

- **App**: Expo (bản SDK ổn định mới nhất — kiểm tra `package.json`, không tự hạ/nâng SDK) + Expo Router, TypeScript `strict`.
- **UI**: StyleSheet + component dùng chung (`src/components/Txt`, `Button`, `Screen`…) lấy số từ `src/theme/tokens.ts`.
  (Không dùng NativeWind: class chữ không ép được cỡ chữ tối thiểu cho người lớn tuổi; component có kiểu thì ép được.)
  **State server**: TanStack Query. **State cục bộ**: Zustand. **Form**: React Hook Form + Zod.
- **Backend**: Supabase (Postgres + RLS, Auth, Storage, Realtime, Edge Functions bằng Deno/TypeScript).
- **Thanh toán**: VietQR qua cổng trung gian (SePay/PayOS/Casso) — webhook vào Edge Function.
- **Hóa đơn**: API của nhà cung cấp HĐĐT mà hộ đã đăng ký (MISA meInvoice, Viettel, VNPT, EasyInvoice…).
  Ứng dụng KHÔNG kết nối trực tiếp tới cơ quan thuế.

Trước khi dùng API của Expo/Supabase/thư viện, tra tài liệu chính thức của đúng phiên bản trong `package.json`.
Không dựa vào trí nhớ cho tên hàm hay cấu hình — nhiều API đã đổi.

## Cấu trúc

```
app/                     Màn hình (Expo Router). (auth)/, (app)/pos/, (app)/invoices/, (app)/journal/
src/features/<tên>/      api.ts (gọi Supabase) → hooks.ts (React Query) → components/
src/lib/supabase.ts      Client duy nhất, có generic Database
src/lib/format.ts        Định dạng VND, ngày, MST
src/types/database.ts    SINH TỰ ĐỘNG — không sửa tay
supabase/migrations/     SQL theo thứ tự thời gian
supabase/functions/      Edge Functions (payment-webhook, issue-einvoice, zalo-webhook…)
supabase/tests/          Kiểm thử SQL cho RLS và nghiệp vụ
```

## Lệnh

```bash
npx expo start                         # chạy app
npm run setup                          # cài thư viện lần đầu (expo install đúng phiên bản SDK)
npx tsc --noEmit                       # kiểm tra kiểu — phải sạch trước khi báo xong
npm test                               # test logic thuần + Edge Functions dùng chung (tsx --test)
npx expo lint                          # lint
supabase start                         # DB local
supabase db reset                      # áp lại toàn bộ migration lên DB local
supabase gen types typescript --local > src/types/database.ts   # sau MỌI thay đổi schema
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -f supabase/tests/rls_and_numbering.sql                          # kiểm thử RLS
supabase functions serve <tên>         # chạy Edge Function local
```

## Quy tắc bắt buộc về dữ liệu và bảo mật

1. **Mọi bảng mới trong `public` phải `enable row level security` và có policy** trong cùng migration.
   Policy dựa trên `public.is_member(business_id)` / `public.has_role(business_id, array[...])`.
   Không viết policy dạng `using (true)`. Thêm ca kiểm thử vào `supabase/tests/` cho mỗi bảng mới.
2. **Tenant là `business_id`**, không phải `auth.uid()`. Bảng nghiệp vụ không tham chiếu trực tiếp `auth.users`
   trừ cột người tạo.
3. **App chỉ gọi những gì có trong `docs/api.md`.** Mọi lệnh ghi đi qua hàm `*_v1` (`create_order_v1`,
   `create_cash_sale_v1`, `cancel_order_v1`…); app không có quyền insert/update `orders`, `order_items`.
   Không tự đặt tên hàm, trường hay endpoint mới — thêm vào `docs/api.md` cùng migration trước.
   **Client không bao giờ tự đổi trạng thái tiền/thuế.** Các việc sau chỉ làm qua hàm SQL hoặc Edge Function:
   - Xác nhận chuyển khoản → `confirm_payment()` (chỉ `service_role`, gọi từ webhook đã xác thực).
   - Xác nhận tay khi webhook chậm → `confirm_transfer_manually()` (có ghi người bấm).
   - Gán tiền chưa rõ đơn → `assign_payment_event()` (chỉ OWNER/MANAGER).
   - Xác nhận tiền mặt → `confirm_cash_payment()`.
   - Cấp số và phát hành hóa đơn → `issue_invoice()` hoặc Edge Function `issue-einvoice`.
   Trigger trong DB đã chặn client; đừng gỡ trigger để "cho tiện".
4. **Không đưa `service_role` key, API key cổng thanh toán, token Zalo OA, thông tin đăng nhập nhà cung cấp HĐĐT
   vào app.** Chỉ để trong secrets của Edge Function. App chỉ có `EXPO_PUBLIC_SUPABASE_URL` và anon key.
5. **Webhook**: luôn xác thực chữ ký/API key của cổng trước khi xử lý; xử lý idempotent theo
   `(provider, provider_txn_id)`; trả 200 nhanh, không gọi API chậm trong luồng webhook.
6. **Không xóa dữ liệu kế toán.** Đơn đã thanh toán, hóa đơn đã phát hành, bút toán từ đơn/hóa đơn: không UPDATE
   nội dung, không DELETE. Sai thì lập hóa đơn điều chỉnh/thay thế (bản ghi mới, `replaces_invoice_id`).
7. **Dữ liệu cá nhân** (Luật BVDLCN 91/2025/QH15, hiệu lực 01/01/2026): chỉ thu thập trường cần thiết, lưu thời điểm
   và nguồn đồng ý (`consent_at`, `consent_source`) cho dữ liệu khách hàng CRM, hỗ trợ xóa theo yêu cầu.
   Không ghi số điện thoại, MST, số định danh vào log.

## Quy tắc nghiệp vụ hóa đơn

- Số hóa đơn 8 chữ số, liên tục theo `(hộ, mẫu số, ký hiệu, năm)`, sang năm mới quay về 1.
  Hiển thị bằng `format_invoice_no()` → `00000042`. Số chỉ cấp khi phát hành, không cấp cho nháp.
- Nếu nhà cung cấp HĐĐT tự cấp số (thường gặp với hóa đơn máy tính tiền): KHÔNG gọi `issue_invoice()`;
  Edge Function lưu số, `tax_authority_code`, `lookup_url` do nhà cung cấp trả về.
- Mẫu số `1` = hóa đơn GTGT (dòng hàng có `vat_rate` 0/5/8/10 hoặc `vat_note` KCT/KKKNT);
  mẫu số `2` = hóa đơn bán hàng (không ghi thuế suất). Hộ nộp thuế theo tỷ lệ % trên doanh thu thường dùng mẫu 2 —
  để người dùng chọn, không tự suy luận.
- Căn cứ pháp lý hiện hành: Luật Quản lý thuế 108/2025/QH15, **NĐ 254/2026/NĐ-CP** và **TT 91/2026/TT-BTC**
  (hiệu lực 01/07/2026, thay NĐ 123/2020 và NĐ 70/2025); thuế hộ kinh doanh theo NĐ 68/2026 sửa đổi bởi NĐ 141/2026.
  Không trích NĐ 123/2020 hay NĐ 70/2025 trong UI/tài liệu mới. Khi viết text pháp lý trong app, ghi
  "tham khảo, không thay thế tư vấn thuế".

## Hiệu năng khi dữ liệu lớn (hàng triệu đơn)

Đo trên 5 triệu đơn, hộ lớn nhất 1 triệu đơn: mọi màn hình chính đọc dưới 1 ms khi theo đúng các quy tắc này.

- **Mọi truy vấn của app lọc theo `business_id` trước tiên** và có index bắt đầu bằng `business_id`. Thêm truy vấn mới
  thì thêm/kiểm tra index trong cùng migration, kèm `EXPLAIN ANALYZE` trên dữ liệu lớn (`supabase/bench/`).
- **Tổng tiền (ngày, tháng, năm) đọc từ `daily_sales`**, không `SUM` trên `orders` (tổng năm: 1 ms so với ~300 ms).
- **Danh sách phân trang keyset** qua `list_orders(…, p_after_sold_at, p_after_id)`; cấm `OFFSET` cho danh sách đơn.
- **RLS dạng tập hợp**: policy đọc trên bảng lớn dùng `business_id in (select my_business_ids())`, không gọi hàm
  kiểm tra quyền cho từng dòng (đếm 30 ngày: 13 ms so với ~430 ms).
- **Hàm đọc chạy quyền người gọi không đặt `set search_path`** (mệnh đề SET chặn PostgreSQL nhúng hàm, làm mất index).
  Hàm `security definer` thì BẮT BUỘC có `set search_path`.
- **Trong điều kiện WHERE trên bảng có RLS, tránh toán tử không leakproof** (so sánh `numeric`, `like` trên kiểu lạ…):
  chúng bị đánh giá sau RLS nên không dùng được index.
- **Webhook khớp mã đơn bằng index** (`order_code = any(order_code_candidates(nội dung))`), không quét chuỗi.
- **Payload thô của webhook nằm ở `payment_event_raw`** (phân vùng theo tháng); chạy `ensure_month_partitions()` hằng tháng
  và `drop_old_raw_partitions(13)` để giữ 13 tháng. Không thêm cột JSON lớn vào `payment_events`.
- **Realtime**: khi một hộ có nhiều máy hoặc hệ thống có hàng nghìn hộ, chuyển từ lắng nghe thay đổi bảng sang Broadcast
  theo kênh của từng hộ (gửi từ trigger), để RLS không phải kiểm tra từng thay đổi cho từng người nghe.
- **Đối soát bảng tổng hợp hằng đêm**: `check_daily_sales()` phải trả 0 dòng; khác 0 là sự cố cần báo.

## Quy ước code

- Tiền VND là số nguyên: kiểu `bigint` trong DB (KHÔNG dùng `numeric` — phép so sánh numeric không được dùng làm điều kiện
  index khi có RLS, đã đo chậm gấp nhiều lần), `number` trong TS (an toàn tới 9×10¹⁵). Không có phần lẻ đồng.
- Định dạng: `formatVND()` trong `src/lib/money.ts` → `18.000 đ` (không dùng Intl: Hermes/Android cũ cho kết quả khác nhau); ngày `dd/MM/yyyy`;
  múi giờ `Asia/Ho_Chi_Minh` cho mọi ngày nghiệp vụ (ngày bán, kỳ thuế), lưu DB bằng `timestamptz`.
- Gọi DB theo lớp: `api.ts` (hàm thuần, ném lỗi đã chuẩn hóa) → `hooks.ts` (`useQuery`/`useMutation`, khóa query
  dạng `['orders', businessId, ...]`) → component. Component không gọi `supabase` trực tiếp.
- Mọi form có schema Zod; thông báo lỗi tiếng Việt, ngắn, nói người dùng cần làm gì.
- Mỗi màn hình có đủ trạng thái: đang tải, rỗng, lỗi (có nút thử lại), mất mạng.
- Realtime: lọc theo `business_id`, hủy subscribe khi unmount. Realtime chỉ để cập nhật UI —
  nguồn sự thật là DB (khi mở lại màn hình phải truy vấn lại trạng thái đơn).
- Offline: chỉ đơn tiền mặt được tạo khi mất mạng, theo hàng đợi ở `docs/api.md` mục 7 (UUID sinh sẵn, gửi lại
  đúng tham số đã lưu). Không phát hành hóa đơn hay xác nhận chuyển khoản khi offline.

## VietQR và đối soát

- **Khớp theo tài khoản nhận tiền trước, nội dung sau.** `confirm_payment()` xác định hộ qua `payment_accounts`
  (bank_bin + account_no), rồi mới tìm mã đơn trong đơn của hộ đó. Không viết truy vấn nào tìm mã đơn trên toàn hệ thống.
- `payment_accounts` chỉ được ghi bởi Edge Function (service_role) sau khi cổng thanh toán xác minh tài khoản thuộc hộ.
  Không tạo màn hình cho người dùng tự gõ số tài khoản nhận tiền vào bảng này.
- Ưu tiên **tài khoản ảo theo đơn** (`kind = 'ORDER_VA'`) khi cổng hỗ trợ: khách xóa/sửa nội dung vẫn khớp.
  Mã đơn trong nội dung chỉ là cách dự phòng (8 ký tự, không có 0/O/1/I/L).
- Kết quả đối soát và cách hiển thị (chữ trên màn hình viết như nói, không hiện mã):
  | `match_status` | Màn hình thu ngân |
  | --- | --- |
  | `MATCHED` | "Đã nhận 18.000đ" (xanh, đọc to) |
  | `OVERPAID` | "Đã nhận 20.000đ — khách chuyển dư 2.000đ" |
  | `PARTIAL` | "Khách mới chuyển 10.000đ, còn thiếu 8.000đ" + QR cho phần còn thiếu |
  | `ALREADY_PAID` | Báo chủ hộ: "Khách chuyển 2 lần cho đơn ABCD2345 — cần trả lại 18.000đ" |
  | `UNMATCHED` | Mục "Tiền chưa rõ đơn" để chủ hộ gán bằng `assign_payment_event()` |
  | `UNKNOWN_ACCOUNT` | Không hiện cho thu ngân; ghi log để kiểm tra cấu hình cổng |
- Webhook chậm: nút "Tôi đã thấy tiền về" gọi `confirm_transfer_manually()`; đơn xác nhận tay quá 15 phút chưa có tiền
  hiện ở `unreconciled_manual_confirmations` cho chủ hộ.
- Tiền mặt khi mất mạng: client tự sinh UUID cho đơn, ghi `sold_at` theo giờ máy, đồng bộ sau bằng `create_cash_sale_v1()`
  (gọi lại nhiều lần vẫn an toàn). Giờ máy sai không làm mất đơn: server dùng giờ của mình và đặt `clock_suspect`.
  Chuyển khoản thì bắt buộc có mạng.
- Đọc to: chỉ máy có `device_id` trùng `orders.created_device_id` đọc to và rung; máy khác trong quán cập nhật im lặng.
- Ảnh QR lấy từ API của cổng đang dùng hoặc tự sinh chuỗi EMVCo VietQR; không hardcode một domain bên thứ ba.

## Dễ dùng — người dùng chính là chủ quán lớn tuổi

Mọi màn hình phải qua được bài kiểm tra: một người 60 tuổi chưa từng thấy app làm được việc chính trong 1 phút, không ai chỉ.

- **Kích thước** (định nghĩa một lần trong `src/theme/`, không dùng số lẻ trong component): chữ thân ≥ 18, số tiền ≥ 32,
  tiêu đề ≥ 22; vùng bấm ≥ 56dp; khoảng cách giữa hai nút ≥ 12dp. Không dùng `text-xs`/`text-sm` cho nội dung chính.
- **Chữ lớn hệ thống**: không tắt `allowFontScaling`; bố cục phải không vỡ ở cỡ chữ lớn nhất của Android/iOS.
  Riêng số tiền cỡ lớn (≥ 32) đặt `maxFontSizeMultiplier={1.3}` và tự thu nhỏ để luôn vừa một dòng
  (`adjustsFontSizeToFit` + `numberOfLines={1}`); chữ thường được phóng to đủ mức.

### Bố cục theo kích thước màn hình (xem hàng 6 trên canvas thiết kế)

Tính theo chiều rộng/cao cửa sổ hiện tại (`useWindowDimensions`), không theo loại máy:

| Cửa sổ | Bố cục |
| --- | --- |
| Rộng < 600 dp, cao < 700 dp (điện thoại nhỏ, màn ngoài máy gập) | Một cột gọn: phím số cao 56, số tiền 40, nút phụ thành liên kết |
| Rộng < 600 dp | Một cột như bản thiết kế 390×844 |
| Rộng ≥ 600 dp (máy gập mở ra, máy tính bảng, máy POS) | Hai cột: bàn phím + số tiền bên trái, QR / kết quả / sổ bên phải |

- Điện thoại (< 600 dp) khóa dọc; màn ≥ 600 dp chạy cả dọc và ngang (Android 16 bỏ qua khóa xoay trên màn lớn).
- Gập/mở máy là đổi kích thước giữa chừng: giữ số đang nhập và đơn đang chờ trong state lưu ngoài component
  (Zustand), không reset khi bố cục đổi. Ở bố cục hai cột trên máy gập, không đặt mã QR vắt qua nếp gập.
- Vẽ tràn viền là mặc định: mọi màn hình bọc trong vùng an toàn (`react-native-safe-area-context`), nút ở đáy
  cộng thêm phần dưới của vùng an toàn để không nằm dưới thanh cử chỉ.
- Khóa giao diện sáng (`userInterfaceStyle: "light"`) ở bản đầu.
- **Màn hình chính**: một nút lớn "Thu tiền" ở đáy + tối đa 6 ô việc có chữ, hai ô một hàng (Sổ hôm nay · Báo cáo · Sổ nợ ·
  Hàng hóa · Chi tiêu · Việc khác — đổi theo góp ý người dùng thử 01/11/2026). "Việc khác" mở danh sách việc ít dùng
  (Khách quen, Ca bán, Thuế, Hóa đơn điện tử, Nhân viên, Cài đặt, Gọi hỗ trợ). Cài đặt, Báo cáo, Thuế, Hóa đơn, Nhân viên
  nằm sau mã PIN chủ hộ. Màn Thu tiền có thêm liên kết chữ: Chọn món · Ghi nợ · Khách quen.
  Cài đặt và Thoát là nút biểu tượng ở góc trên (có accessibilityLabel bằng chữ, theo góp ý 01/11/2026). "Thoát" hỏi lại rồi
  đóng app (Android; iOS không có nút này), không đăng xuất. "Đăng xuất" là nút cuối cùng của Cài đặt.
  Hai nút bị khóa không được hiện cùng một chữ. Nút lựa chọn (kỳ báo cáo, ngành nghề…) đang chọn chỉ đổi màu nền, không thêm dấu
  hay đổi độ dày viền để không giật bố cục.
- **Thu tiền mặc định** = bàn phím số lớn có phím "000" → bấm "Hiện mã QR". Danh mục sản phẩm là tùy chọn, không bắt buộc.
  Luôn hiện số kèm chữ: "18.000 đ — mười tám nghìn đồng".
- **Báo tiền về** bằng 3 kênh cùng lúc: giọng nói tiếng Việt (`expo-speech`, "Đã nhận mười tám nghìn"), rung, cả màn hình
  chuyển xanh ít nhất 3 giây. Khi app ở nền: thông báo đẩy có âm thanh. Không dùng toast nhỏ tự tắt cho sự kiện tiền.
- **Một màn hình một việc, một nút chính.** Không dựa vào vuốt, nhấn giữ, biểu tượng không có chữ (ngoại lệ duy nhất: hai nút Cài đặt/Thoát ở góc trang chính theo yêu cầu người dùng), menu ba chấm.
- **Chữ**: mọi chuỗi hiển thị nằm trong `src/i18n/vi.ts`; cấm hiện mã lỗi, tên bảng, tên trạng thái (`PARTIAL`, `HĐĐT`,
  `MST`, "đồng bộ", "webhook"). Viết như nói, có việc cần làm: "Mất mạng. Đơn đã lưu, sẽ gửi khi có mạng."
- **Không có thao tác mất dữ liệu**: hủy đơn có xác nhận + hoàn tác 5 giây; không có nút xóa vĩnh viễn trong app.
- **Đăng nhập**: số điện thoại + OTP, giữ đăng nhập lâu dài; nhân viên dùng PIN 4 số trên máy của quán.
- **Cài đặt ban đầu**: lấy tài khoản nhận tiền qua cổng thanh toán (không bắt gõ số tài khoản); tra thông tin hộ từ mã số thuế.
- **Tương phản**: chữ trên nền đạt tối thiểu 4.5:1; không truyền tải ý nghĩa chỉ bằng màu (xanh/đỏ luôn kèm chữ).
- **Kiểm thử bắt buộc cho màn hình mới**: chạy ở cỡ chữ hệ thống lớn nhất, trên máy Android tầm thấp (RAM 3GB),
  mạng 3G giả lập; chụp màn hình đính kèm khi báo xong.

## Khi hoàn thành một thay đổi

1. `npx tsc --noEmit` và lint sạch.
2. Nếu đổi schema: migration mới (không sửa migration đã chạy), `supabase db reset`, chạy `supabase/tests/`,
   sinh lại `src/types/database.ts`.
3. Nêu rõ trong tóm tắt: đã kiểm thử gì, chưa kiểm thử được gì (ví dụ: chưa thử với sandbox nhà cung cấp HĐĐT).

## Không làm

- Không thêm thư viện mới khi chưa hỏi.
- Không tắt RLS, không dùng `service_role` trong app, không `security definer` mà thiếu `set search_path`.
- Không bịa mã lỗi, endpoint, trường dữ liệu của nhà cung cấp HĐĐT hay cổng thanh toán — đọc tài liệu sandbox của họ,
  nếu chưa có thì để `TODO` rõ ràng.
