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
