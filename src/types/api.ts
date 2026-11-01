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
  product_id?: string;
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
}

export type StockOutReason = 'EXPIRED' | 'DAMAGED' | 'USED' | 'OTHER';

export interface StockLot {
  id: string;
  product_id: string;
  expires_on: string | null;
  qty_in: number;
  qty_left: number;
  created_at: string;
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
