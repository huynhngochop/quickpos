# Lộ trình chức năng sau góp ý người dùng thử (01/11/2026)

Góp ý: app cài lâu; thiếu thống kê, báo cáo, kê khai thuế; hai nút cùng chữ; không có nút thoát.
Đối chiếu với các app bán hàng cho hộ kinh doanh đang phổ biến (KiotViet, Sapo, MISA eShop, "Sổ bán hàng")
và quy định thuế hộ kinh doanh từ 2026 (bỏ thuế khoán, ngưỡng 1 tỷ theo NĐ 141/2026, mẫu theo TT 18/2026).

## Đã làm (bản thử 18)

| Việc | Vai trò ghi nhận | Ghi chú |
| --- | --- | --- |
| Sửa hai nút cùng chữ "Nhập số tiền trước" ở màn Thu tiền | QC | Nút giữ tên, một dòng hướng dẫn chung |
| Nút "Thoát" trên trang chính, có hỏi lại | QC, PM | Chặn thoát khi còn đơn tiền mặt chưa gửi |
| APK chỉ gói arm64-v8a | Dev | Nhẹ khoảng 1/3, cài nhanh hơn |
| Báo cáo theo kỳ + so kỳ trước + lãi ước tính + gửi sổ doanh thu (CSV) | PM | Đọc `daily_sales`, không cộng `orders` |
| Chi tiêu (sổ chi) | PM | Không xóa, chỉ đánh dấu hủy |
| Sổ nợ khách + nhắn nhắc nợ | PM | Số điện thoại cần khách đồng ý (Luật BVDLCN) |
| Thuế: ngưỡng 1 tỷ, dự báo cả năm, ước tính theo ngành, hạn nộp, xuất số liệu | PM | Ghi rõ "tham khảo, không thay thế tư vấn thuế" |

## Tiếp theo (đề xuất ưu tiên)

| Ưu tiên | Việc | Vì sao |
| --- | --- | --- |
| P1 | Danh mục món/hàng + nút bán nhanh, số lượng | Quán ăn, cà phê cần bấm món thay vì gõ tiền; là nền cho tồn kho và hóa đơn có dòng hàng |
| P1 | Hóa đơn điện tử từ máy tính tiền qua nhà cung cấp (MISA meInvoice, Viettel, VNPT) | NĐ 254/2026: bán lẻ, ăn uống bán trực tiếp cho người tiêu dùng thuộc diện dùng hóa đơn máy tính tiền; hộ > 1 tỷ bắt buộc hóa đơn điện tử |
| P1 | Thu nợ bằng mã QR (khách quét trả nợ, tự trừ sổ nợ) | Nối sổ nợ với VietQR sẵn có |
| P1 | In biên nhận máy in nhiệt Bluetooth / gửi ảnh biên nhận qua Zalo | Khách hỏi biên nhận; quán ăn cần in bếp |
| P2 | Tồn kho đơn giản (nhập hàng → cộng kho, bán → trừ kho, cảnh báo sắp hết) | Tạp hóa; TT 18/2026 có bảng kê hàng tồn kho 01/BK-HTK |
| P2 | Đóng ca / bàn giao két tiền mặt cho nhân viên | Quán có thu ngân |
| P2 | Mời nhân viên bằng số điện thoại, phân quyền | Màn "Nhân viên" hiện chỉ xem |
| P2 | Xuất file Excel thật (.xlsx) và sổ doanh thu theo mẫu kế toán hộ kinh doanh | Kế toán dịch vụ cần đúng mẫu |
| P3 | Khách quen, tích điểm, nhắn Zalo OA | Bảng CRM đã có trong migration 2 |
| P3 | Báo cáo theo giờ, theo món bán chạy | Cần danh mục món (P1) |

## Kiểm thử cho mỗi việc

- SQL: hàm `*_v1` mới có kiểm thử quyền (thu ngân / chủ / quán khác), gửi lại an toàn, mã lỗi QP_*.
- Logic thuần (thuế, kỳ báo cáo): `tests/*.test.ts`.
- Giao diện: luồng Maestro chạy 2 vòng trên điện thoại Android, máy tính bảng nằm ngang, iPhone.
- Hiệu năng: thêm truy vấn mới vào `supabase/bench/bench_queries.sql`, đo trên DB 5 triệu đơn.

---

# Các giai đoạn dữ liệu (chốt 07/11/2026)

| Giai đoạn | Dữ liệu ở đâu | Nhiều máy | Trạng thái |
| --- | --- | --- | --- |
| **1. Một máy** | SQLite của app trên máy đó (`src/lib/demoClient.ts` + `localStore.ts`) | Không; nhân viên dùng chung máy, màn của chủ có PIN | **Đang dùng** (apk-23) |
| **2. Nhiều máy trong quán, không qua Internet** | Một "máy chủ quán" trong mạng Wi‑Fi của quán | 2–10 máy cùng mạng Wi‑Fi | Ghi chú thiết kế bên dưới, chưa code |
| **3. Máy chủ đám mây (Premium)** | Supabase (đã viết: migration 1–8, Edge Functions) | Không giới hạn, khác mạng, chủ xem từ xa | Chờ tạo dự án Supabase + SMS + cổng thanh toán |

## Giai đoạn 2 — máy chủ quán trong mạng Wi‑Fi (ghi chú thiết kế)

**Ý chính: không đồng bộ hai chiều giữa các máy.** Một máy giữ dữ liệu (máy chủ quán), các máy khác chỉ gửi lệnh
tới đó. Như vậy không có chuyện hai bản dữ liệu ghi đè nhau, cũng không phải giải xung đột.

### Chọn cách nối

| Cách | Đánh giá |
| --- | --- |
| **A. Máy chính của quán (máy tính bảng / điện thoại Android) chạy luôn máy chủ nhỏ trong app; máy nhân viên nối qua WebSocket** | **Chọn.** Không mua thêm thiết bị; dùng lại nguyên bộ máy dữ liệu hiện có |
| B. Hộp riêng (mini PC, Android TV box) chạy Postgres + đúng các migration của giai đoạn 3 | Ổn định hơn nhưng phải mua, cài, bảo trì thiết bị; để dành cho quán lớn |
| C. Mỗi máy giữ một bản, đồng bộ ngang hàng (CRDT) | Không chọn: phức tạp, sổ tiền/kho/số hóa đơn cần một nguồn sự thật |
| D. TCP thô tự định khung | Không chọn: WebSocket (chạy trên TCP) có sẵn khung tin, đẩy tin hai chiều, ping giữ kết nối |

### Cách làm (cách A)

1. **Giao thức = đúng hợp đồng API hiện tại** (`docs/api.md`). Máy nhân viên dùng `LanClient`, có cùng giao diện
   `rpc()` / `from().select()` / `channel()` như `supabase` và `demoClient`. Mỗi lệnh gửi qua WebSocket là JSON
   `{ id, type: 'rpc' | 'select', name, args }`; máy chủ quán chạy `rpcImpl` / `Query` của `demoClient` rồi trả kết quả.
   Màn hình và `features/*/api.ts` giữ nguyên. Sau này đổi sang giai đoạn 3 chỉ cần thay client.
2. **Đẩy tin**: máy chủ quán gửi `{ type: 'order', row }` cho mọi máy khi đơn đổi trạng thái (thay `channel()` / Realtime).
   Chỉ máy tạo đơn đọc to, giữ đúng quy tắc `created_device_id` hiện có.
3. **Ghép máy bằng mã QR**: Cài đặt → "Thêm máy nhân viên" trên máy chủ quán hiện mã QR chứa
   `ws://<IP>:<cổng>`, mã ghép dùng một lần (5 phút) và dấu vân tay khóa công khai của máy chủ.
   Máy nhân viên quét mã đó, nhận `device_token` riêng và vai trò (thu ngân / quản lý). Chủ quán thu hồi được từng máy.
4. **Tìm lại máy chủ khi IP đổi**: dò mDNS (`_quickpos._tcp`) trong mạng; không thấy thì cho quét lại mã QR.
5. **Bảo mật trong mạng Wi‑Fi**:
   - Mỗi tin ký HMAC bằng `device_token`, kèm số thứ tự chống gửi lại.
   - Khi ghép máy, trao khóa và mã hóa kênh (Noise/libsodium), vì Wi‑Fi quán thường dùng chung với khách.
   - Quyền kiểm tra ở máy chủ quán theo vai trò, như `has_role` của giai đoạn 3.
   - Chỉ nghe trên mạng nội bộ.
6. **Khi mất kết nối tới máy chủ quán**:
   - Máy nhân viên vẫn bán **tiền mặt** bằng hàng đợi hiện có (UUID sinh sẵn, gửi lại an toàn).
   - Bán **chuyển khoản**: máy nhân viên tự tạo mã QR (đã biết tài khoản quán) với mã đơn có tiền tố theo máy để
     không trùng, xác nhận tay, gửi lên khi nối lại.
   - Báo cáo / thuế / sổ chỉ xem trên máy chủ quán hoặc khi đang nối.
7. **Máy chủ quán phải luôn chạy**:
   - Android có dịch vụ chạy nền (foreground service, có thông báo thường trực) và giữ màn hình sáng khi cắm sạc.
   - **iOS không làm máy chủ quán được** (hệ điều hành tắt máy chủ chạy nền), iPhone chỉ làm máy nhân viên.
   - Sao lưu ra file vẫn làm trên máy chủ quán.
   **Pin / nóng** (trả lời 07/11/2026):
   - Phần máy chủ rất nhẹ (vài lệnh mỗi phút, gói tin nhỏ, SQLite).
   - Tốn pin chủ yếu do giữ Wi‑Fi và CPU không ngủ: chỉ giữ khi có máy nhân viên đang nối, không bắt sáng màn hình,
     ban đêm / ngoài giờ bán thì nghỉ. Đo thực tế ở bản thử phase 2.
   - Khuyên dùng **máy riêng ở quầy** (máy tính bảng / điện thoại Android cũ, cắm sạc, bật giới hạn sạc 80% nếu máy có)
     làm máy chủ quán, không dùng điện thoại cá nhân của chủ. Lý do: chủ mang máy đi thì cả quán mất máy chủ;
     hãng máy (Xiaomi, Oppo, Vivo, Samsung…) hay tự tắt app chạy nền, phải hướng dẫn tắt tối ưu pin cho QuickPOS.
8. **Giới hạn**: 2–10 máy, cùng một mạng Wi‑Fi. Router bật "cách ly máy khách" hoặc máy nhân viên vào mạng khách thì
   không thấy nhau: màn ghép máy phải báo rõ điều này.
9. **Thư viện cần thêm (hỏi trước khi thêm)**:
   - máy chủ TCP/WebSocket chạy trong app (`react-native-tcp-socket` hoặc module native nhỏ);
   - dò mDNS (`react-native-zeroconf`);
   - mã hóa (`react-native-libsodium`).
   Cả ba cần build native (đã dùng `expo prebuild`).
10. **Kiểm thử**:
    - QA Maestro hai máy ảo cùng mạng: ghép máy, bán trên máy nhân viên, máy chủ quán báo đơn.
    - Rút Wi‑Fi rồi cắm lại: đơn chờ gửi lên đủ.
    - Đổi IP: tìm lại được máy chủ quán.

### Ước lượng
Khoảng 2–3 tuần cho cách A: máy chủ trong app, LanClient, ghép máy, đẩy tin, mất kết nối, QA hai máy.
Không đổi màn hình bán hàng.
