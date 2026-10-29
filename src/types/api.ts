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
