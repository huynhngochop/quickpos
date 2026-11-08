/**
 * Kiểu dữ liệu app dùng, viết theo docs/api.md và migration.
 * Khi đã chạy `supabase gen types typescript --local > src/types/database.ts`, đổi các kiểu dòng
 * bên dưới sang `Tables<'orders'>`… và xóa phần trùng.
 */
export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'ACCOUNTANT';
export type PaymentMethod = 'VIETQR' | 'CASH' | 'CARD';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'CANCELLED' | 'REFUNDED';
export type MatchStatus =
  | 'MATCHED'
  | 'OVERPAID'
  | 'PARTIAL'
  | 'UNMATCHED'
  | 'UNKNOWN_ACCOUNT'
  | 'ALREADY_PAID'
  | 'ORDER_CLOSED'
  | 'LATE_CONFIRMED';

export interface Order {
  id: string;
  business_id: string;
  order_code: string;
  total_amount: number;
  amount_received: number;
  overpaid_amount: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  paid_at: string | null;
  manual_confirmed_by: string | null;
  manual_confirmed_at: string | null;
  manual_note: string | null;
  sold_at: string;
  client_sold_at: string | null;
  clock_suspect: boolean;
  created_device_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemInput {
  name: string;
  quantity: number;
  unit_price: number;
  product_id?: string | null;
  /** Giảm giá của dòng (khuyến mãi theo món), đồng */
  discount_amount?: number;
  promotion_id?: string | null;
  /** Món tặng (giá 0, trừ kho, không tính doanh thu) */
  is_gift?: boolean;
}

/** Dòng hàng + giảm giá cả đơn gửi lên create_order_v1 / create_cash_sale_v1 */
export interface OrderInput {
  items: OrderItemInput[];
  discount_amount: number;
  promotion_id: string | null;
}

export interface Business {
  id: string;
  business_name: string;
  tax_code: string;
  address: string;
  allow_cashier_manual_confirm: boolean;
  /** Ngành nghề tính thuế (migration 6). Bản cũ chưa có cột → coi như GOODS. */
  tax_industry?: 'GOODS' | 'PRODUCTION' | 'SERVICE' | 'LEASING' | 'OTHER';
  /** Migration 7 */
  loyalty_vnd_per_point?: number;
  einvoice_provider?: 'NONE' | 'DEMO' | 'MISA' | 'VIETTEL' | 'VNPT' | 'OTHER';
  invoice_form_no?: '1' | '2';
  invoice_symbol?: string | null;
  /** Migration 9: thu ngân được giảm giá tay */
  allow_cashier_discount?: boolean;
  /** Họ tên chủ hộ (người nộp thuế, mẫu 01/TKN-CNKD) */
  owner_name?: string | null;
}

export interface Membership {
  role: Role;
  business: Business;
}

export interface PaymentAccount {
  id: string;
  business_id: string;
  provider: string;
  bank_bin: string;
  account_no: string;
  kind: 'MAIN' | 'COUNTER' | 'ORDER_VA';
  label: string | null;
  is_active: boolean;
}

export interface PaymentEvent {
  id: string;
  business_id: string | null;
  order_id: string | null;
  provider: string;
  bank_bin: string | null;
  account_no: string | null;
  amount: number;
  transfer_content: string | null;
  match_status: MatchStatus;
  received_at: string;
}

/** View `unreconciled_manual_confirmations`: `id` là mã đơn. */
export interface UnreconciledManual {
  id: string;
  business_id: string;
  order_code: string;
  total_amount: number;
  amount_received: number;
  manual_confirmed_by: string | null;
  manual_confirmed_at: string;
  manual_note: string | null;
}

export interface DaySummaryRow {
  method: PaymentMethod;
  orders_count: number;
  amount: number;
}

export interface DailySalesRow {
  business_id: string;
  sale_date: string;
  method: PaymentMethod;
  orders_count: number;
  amount: number;
}

export interface AppVersionCheck {
  must_update: boolean;
  should_update: boolean;
  latest_version: string;
  store_url: string | null;
}

export interface QrForOrder {
  qr_payload: string;
  bank_name: string;
  account_name: string;
  amount: number;
  /** true = QR tài khoản chính, khách phải giữ nguyên nội dung có mã đơn */
  uses_order_code: boolean;
  order_code: string;
  expires_at: string | null;
}

/** Khoản chi ghi tay (journal_entries, entry_type = EXPENSE, source = MANUAL). `source_id` là mã app sinh. */
export interface ExpenseRow {
  id: string;
  source_id: string;
  amount: number;
  category: string;
  description: string | null;
  entry_date: string;
  created_at: string;
}

/** View `debt_balances` */
export interface DebtBalance {
  customer_id: string;
  business_id: string;
  name: string;
  phone: string | null;
  balance: number;
  last_entry_at: string | null;
}

export interface DebtEntry {
  id: string;
  customer_id: string;
  kind: 'DEBT' | 'PAYMENT';
  amount: number;
  note: string | null;
  entry_date: string;
  created_at: string;
  voided_at: string | null;
}

// ---------- Migration 7 ----------
export interface Product {
  id: string;
  business_id: string;
  name: string;
  unit: string;
  price: number;
  category: string | null;
  cost_price: number | null;
  track_stock: boolean;
  stock_qty: number;
  low_stock_at: number | null;
  is_active: boolean;
  /** Mã vạch / mã QR in sẵn trên hàng (migration 8) */
  barcode: string | null;
  /** Hàng có hạn dùng: nhập theo lô có ngày hết hạn */
  track_expiry: boolean;
  /** Báo trước bao nhiêu ngày khi lô sắp hết hạn */
  expiry_warn_days: number;
  /** Danh mục (migration 9); `category` giữ tên để hiện nhanh */
  category_id: string | null;
  /** Nhà cung cấp thường nhập (chọn sẵn khi nhập hàng) */
  supplier_id: string | null;
}

/** Hàng tặng (GIFT), hàng mẫu (SAMPLE): xuất kho, không tính doanh thu */
export type StockOutReason = 'EXPIRED' | 'DAMAGED' | 'USED' | 'GIFT' | 'SAMPLE' | 'OTHER';

export interface StockLot {
  id: string;
  product_id: string;
  expires_on: string | null;
  qty_in: number;
  qty_left: number;
  created_at: string;
  unit_cost?: number | null;
  supplier_id?: string | null;
  received_on?: string | null;
}

// ---------- Migration 9: danh mục, nhà cung cấp, phiếu nhập, khuyến mãi, kiểm kê ----------
/** Nhóm ngành tính thuế (mẫu 01/TKN-CNKD): 1 hàng hóa, 2 dịch vụ, 3 cho thuê tài sản, 4 sản xuất / ăn uống, 5 nội dung số, 6 khác */
export type TaxGroup = 'GOODS' | 'SERVICE' | 'LEASING' | 'PRODUCTION' | 'DIGITAL' | 'OTHER';

export interface Category {
  id: string;
  business_id: string;
  name: string;
  sort_order: number;
  /** Nhóm ngành riêng của danh mục (null = theo ngành của quán) */
  tax_group: TaxGroup | null;
  /** Hàng mới trong danh mục mặc định có hạn dùng */
  track_expiry_default: boolean;
}

export interface Supplier {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  tax_code: string | null;
  note: string | null;
}

/** rpc('supplier_balances') */
export interface SupplierBalance {
  supplier_id: string;
  name: string;
  phone: string | null;
  purchased: number;
  paid: number;
  /** > 0: quán còn nợ nhà cung cấp */
  balance: number;
  last_purchase_on: string | null;
}

export interface Purchase {
  id: string;
  supplier_id: string | null;
  purchased_on: string;
  total_amount: number;
  paid_amount: number;
  line_count: number;
  note: string | null;
  created_at: string;
}

export interface SupplierPayment {
  id: string;
  supplier_id: string;
  amount: number;
  paid_on: string;
  note: string | null;
  purchase_id: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface SuppliedProduct {
  product_id: string;
  name: string;
  unit: string;
  qty_total: number;
  last_cost: number | null;
  last_on: string | null;
  archived: boolean;
}

/** rpc('supplier_detail') */
export interface SupplierDetail {
  supplier: Supplier;
  purchased: number;
  paid: number;
  balance: number;
  purchases: Purchase[];
  payments: SupplierPayment[];
  products: SuppliedProduct[];
}

/** rpc('product_suppliers') */
export interface ProductSupplier {
  supplier_id: string;
  name: string;
  qty_total: number;
  last_cost: number | null;
  last_on: string | null;
  is_default: boolean;
}

export interface PurchaseLineInput {
  movement_id: string;
  product_id: string;
  qty: number;
  unit_cost: number | null;
  expires_on: string | null;
}

export type StockCountStatus = 'OPEN' | 'DONE' | 'CANCELLED';

export interface StockCount {
  id: string;
  business_id: string;
  status: StockCountStatus;
  note: string | null;
  started_at: string;
  finished_at: string | null;
  lines_total: number;
  lines_diff: number;
  value_diff: number;
}

export interface StockCountLine {
  id: string;
  product_id: string;
  name: string;
  unit: string;
  expected_qty: number;
  counted_qty: number;
  diff: number;
  counted_at: string;
  cost_price: number | null;
}

/** rpc('stock_count_detail') */
export interface StockCountDetail {
  count: StockCount;
  lines: StockCountLine[];
  /** Hàng có theo dõi tồn chưa đếm (chỉ khi phiên đang mở) */
  pending: { product_id: string; name: string; unit: string; stock_qty: number; category_id: string | null; barcode: string | null }[];
}

/** rpc('revenue_notice') — số liệu điền mẫu 01/TKN-CNKD */
export interface RevenueNotice {
  business_name: string;
  owner_name: string | null;
  tax_code: string;
  address: string;
  tax_industry: TaxGroup;
  from: string;
  to: string;
  total: number;
  orders: number;
  by_group: Partial<Record<TaxGroup, number>>;
}

/** rpc('expiring_lots') — days_left < 0: đã quá hạn */
export interface ExpiringLot {
  lot_id: string;
  product_id: string;
  name: string;
  unit: string;
  expires_on: string;
  qty_left: number;
  days_left: number;
}

/** rpc('stock_report') — xuất nhập tồn một món trong kỳ */
export interface StockReportRow {
  product_id: string;
  name: string;
  unit: string;
  opening: number;
  qty_in: number;
  qty_sold: number;
  qty_out: number;
  qty_adjust: number;
  closing: number;
  cost_price: number | null;
  closing_value: number | null;
}

export interface StockMovement {
  id: string;
  product_id: string;
  kind: 'IN' | 'SALE' | 'COUNT' | 'OUT';
  qty: number;
  unit_cost: number | null;
  order_id: string | null;
  note: string | null;
  reason?: StockOutReason | null;
  lot_id?: string | null;
  created_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  line_amount: number;
}

export interface HourRow {
  hour: number;
  orders: number;
  amount: number;
}

export interface TopProductRow {
  product_id: string;
  name: string;
  quantity: number;
  amount: number;
}

export interface CurrentShift {
  shift_id: string;
  opened_at: string;
  opening_cash: number;
  cash_sales: number;
  cash_orders: number;
  cash_expenses: number;
  expected_cash: number;
}

export interface ClosedShift {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  cash_sales: number | null;
  cash_expenses: number | null;
  expected_cash: number | null;
  counted_cash: number | null;
  note: string | null;
}

export interface MemberRow {
  user_id: string;
  role: Role;
  member_phone: string | null;
}

export interface InviteRow {
  id: string;
  phone: string;
  role: Role;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface Customer {
  id: string;
  business_id: string;
  display_name: string;
  phone_number: string | null;
  points: number;
  total_spent: number;
  visits: number;
  last_visit_at: string | null;
}

export interface LoyaltyEvent {
  id: string;
  customer_id: string;
  order_id: string | null;
  kind: 'EARN' | 'REDEEM';
  points: number;
  note: string | null;
  created_at: string;
}

export type EinvoiceProvider = 'NONE' | 'DEMO' | 'MISA' | 'VIETTEL' | 'VNPT' | 'OTHER';

export interface Invoice {
  id: string;
  business_id: string;
  order_id: string | null;
  form_no: '1' | '2';
  symbol: string;
  invoice_no: number | null;
  status: string;
  buyer_name: string | null;
  buyer_tax_code: string | null;
  buyer_email: string | null;
  total_amount: number;
  issued_at: string | null;
  tax_authority_code: string | null;
  lookup_url: string | null;
}
