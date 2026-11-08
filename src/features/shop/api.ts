/**
 * Hàng hóa, tồn kho, ca bán, nhân viên, khách quen, hóa đơn điện tử, báo cáo theo giờ/món (migration 7).
 * Chỉ các lời gọi có trong docs/api.md. Mọi lệnh ghi qua hàm *_v1, mã do app sinh để gửi lại an toàn.
 */
import { supabase } from '../../lib/supabase';
import { callWithRetry, unwrap } from '../../lib/retry';
import { toAppError } from '../../lib/errors';
import type {
  Business, ClosedShift, CurrentShift, Customer, EinvoiceProvider, ExpiringLot, HourRow, InviteRow, Invoice, LoyaltyEvent,
  Order, OrderItemRow, Product, Role, StockLot, StockMovement, StockOutReason, StockReportRow, TopProductRow,
  Category, Supplier, SupplierBalance, SupplierDetail, ProductSupplier, Purchase, PurchaseLineInput, SupplierPayment,
  StockCount, StockCountDetail, StockCountLine, RevenueNotice, TaxGroup,
} from '../../types/api';

const rpc = <T>(name: string, args: Record<string, unknown>) =>
  callWithRetry(async (signal) => unwrap(await supabase.rpc(name, args).abortSignal(signal)) as T);

// ---------- Hàng hóa ----------
export const PRODUCT_COLS =
  'id, business_id, name, unit, price, category, category_id, supplier_id, cost_price, track_stock, stock_qty, low_stock_at, is_active, barcode, track_expiry, expiry_warn_days';

export async function listProducts(businessId: string, includeInactive = false): Promise<Product[]> {
  return callWithRetry(async (signal) => {
    // Món đã xóa (archived_at) không hiện ở đâu nữa; vẫn còn trong sổ sách và báo cáo
    let q = supabase.from('products').select(PRODUCT_COLS).eq('business_id', businessId).is('archived_at', null);
    if (!includeInactive) q = q.eq('is_active', true);
    return unwrap(await q.order('sort_order', { ascending: true }).order('name', { ascending: true }).limit(500).abortSignal(signal)) as Product[];
  });
}

export interface ProductInput {
  productId: string; businessId: string; name: string; price: number; unit: string; categoryId?: string | null; supplierId?: string | null;
  costPrice?: number | null; trackStock: boolean; lowStockAt?: number | null;
  barcode?: string | null; trackExpiry?: boolean; expiryWarnDays?: number;
}

export function upsertProduct(p: ProductInput) {
  return rpc<Product>('upsert_product_v2', {
    p_product_id: p.productId, p_business_id: p.businessId, p_name: p.name, p_price: p.price, p_unit: p.unit,
    p_category_id: p.categoryId ?? null, p_supplier_id: p.supplierId ?? null, p_cost_price: p.costPrice ?? null, p_track_stock: p.trackStock, p_low_stock_at: p.lowStockAt ?? null,
    p_barcode: p.barcode?.trim() || null, p_track_expiry: !!p.trackExpiry, p_expiry_warn_days: p.expiryWarnDays ?? 7,
  });
}

/** 'DELETED' = xóa hẳn (chưa từng bán/nhập); 'ARCHIVED' = ẩn, giữ sổ sách */
export const deleteProduct = (productId: string) => rpc<'DELETED' | 'ARCHIVED'>('delete_product_v1', { p_product_id: productId });

export const setProductActive = (productId: string, active: boolean) =>
  rpc<Product>('set_product_active_v1', { p_product_id: productId, p_active: active });

export const stockIn = (p: {
  movementId: string; productId: string; qty: number; unitCost?: number | null; note?: string; recordExpense: boolean; expiresOn?: string | null;
  supplierId?: string | null; paidAmount?: number;
}) =>
  rpc<Product>('stock_in_v2', {
    p_movement_id: p.movementId, p_product_id: p.productId, p_qty: p.qty, p_unit_cost: p.unitCost ?? null,
    p_note: p.note ?? null, p_record_expense: p.recordExpense, p_expires_on: p.expiresOn ?? null,
    p_supplier_id: p.supplierId ?? null, p_paid_amount: p.paidAmount ?? null,
  });

export const stockOut = (p: { movementId: string; productId: string; qty: number; reason: StockOutReason; lotId?: string | null; note?: string }) =>
  rpc<Product>('stock_out_v1', {
    p_movement_id: p.movementId, p_product_id: p.productId, p_qty: p.qty, p_reason: p.reason, p_lot_id: p.lotId ?? null, p_note: p.note ?? null,
  });

export async function listLots(productId: string): Promise<StockLot[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('stock_lots')
        .select('id, product_id, expires_on, qty_in, qty_left, created_at, unit_cost, supplier_id, received_on')
        .eq('product_id', productId)
        .gt('qty_left', 0)
        .order('expires_on', { ascending: true })
        .abortSignal(signal),
    ) as StockLot[],
  );
}

export const expiringLots = (businessId: string) => rpc<ExpiringLot[]>('expiring_lots', { p_business_id: businessId });

export const stockReport = (businessId: string, from: string, to: string) =>
  rpc<StockReportRow[]>('stock_report', { p_business_id: businessId, p_from: from, p_to: to });

export const stockCount = (p: { movementId: string; productId: string; actualQty: number; note?: string }) =>
  rpc<Product>('stock_count_v1', { p_movement_id: p.movementId, p_product_id: p.productId, p_actual_qty: p.actualQty, p_note: p.note ?? null });

export async function listMovements(productId: string): Promise<StockMovement[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('stock_movements')
        .select('id, product_id, kind, qty, unit_cost, order_id, note, reason, lot_id, created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(50)
        .abortSignal(signal),
    ) as StockMovement[],
  );
}

// ---------- Đơn: chi tiết, dòng hàng ----------
export async function getOrder(orderId: string): Promise<Order & { customer_id?: string | null; debt_customer_id?: string | null }> {
  return callWithRetry(async (signal) => unwrap(await supabase.from('orders').select('*').eq('id', orderId).abortSignal(signal).single()));
}

export async function orderItems(orderId: string): Promise<OrderItemRow[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('order_items')
        .select('id, order_id, product_id, name, quantity, unit_price, line_amount')
        .eq('order_id', orderId)
        .abortSignal(signal),
    ) as OrderItemRow[],
  );
}

// ---------- Báo cáo theo giờ, món bán chạy ----------
export const salesByHour = (businessId: string, from: string, to: string) =>
  rpc<HourRow[]>('sales_by_hour', { p_business_id: businessId, p_from: from, p_to: to });

export const topProducts = (businessId: string, from: string, to: string, limit = 10) =>
  rpc<TopProductRow[]>('top_products', { p_business_id: businessId, p_from: from, p_to: to, p_limit: limit });

// ---------- Ca bán ----------
export async function currentShift(businessId: string): Promise<CurrentShift | null> {
  const rows = await rpc<CurrentShift[]>('current_shift_v1', { p_business_id: businessId });
  return rows[0] ?? null;
}
export const openShift = (shiftId: string, businessId: string, openingCash: number) =>
  rpc<ClosedShift>('open_shift_v1', { p_shift_id: shiftId, p_business_id: businessId, p_opening_cash: openingCash });
export const closeShift = (shiftId: string, countedCash: number, note?: string) =>
  rpc<ClosedShift>('close_shift_v1', { p_shift_id: shiftId, p_counted_cash: countedCash, p_note: note ?? null });

export async function recentShifts(businessId: string): Promise<ClosedShift[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('cash_shifts')
        .select('id, opened_at, closed_at, opening_cash, cash_sales, cash_expenses, expected_cash, counted_cash, note')
        .eq('business_id', businessId)
        .order('opened_at', { ascending: false })
        .limit(10)
        .abortSignal(signal),
    ) as ClosedShift[],
  );
}

// ---------- Nhân viên ----------
export async function listInvites(businessId: string): Promise<InviteRow[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('business_invites')
        .select('id, phone, role, created_at, accepted_at, revoked_at')
        .eq('business_id', businessId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .abortSignal(signal),
    ) as InviteRow[],
  );
}
export const inviteMember = (inviteId: string, businessId: string, phone: string, role: Role) =>
  rpc<InviteRow>('invite_member_v1', { p_invite_id: inviteId, p_business_id: businessId, p_phone: phone, p_role: role });
export const revokeInvite = (inviteId: string) => rpc<InviteRow>('revoke_invite_v1', { p_invite_id: inviteId });
export const setMemberRole = (businessId: string, userId: string, role: Role) =>
  rpc<null>('set_member_role_v1', { p_business_id: businessId, p_user_id: userId, p_role: role });
export const removeMember = (businessId: string, userId: string) =>
  rpc<null>('remove_member_v1', { p_business_id: businessId, p_user_id: userId });

// ---------- Khách quen ----------
export const CUSTOMER_COLS = 'id, business_id, display_name, phone_number, points, total_spent, visits, last_visit_at';

export async function listCustomers(businessId: string): Promise<Customer[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('crm_customers')
        .select(CUSTOMER_COLS)
        .eq('business_id', businessId)
        .order('last_visit_at', { ascending: false, nullsFirst: false })
        .limit(500)
        .abortSignal(signal),
    ) as Customer[],
  );
}
export const upsertCustomer = (p: { customerId: string; businessId: string; name: string; phone?: string; consent: boolean }) =>
  rpc<Customer>('upsert_customer_v1', {
    p_customer_id: p.customerId, p_business_id: p.businessId, p_name: p.name, p_phone: p.phone || null, p_consent: p.consent,
  });
export const setOrderCustomer = (orderId: string, customerId: string) =>
  rpc<Order>('set_order_customer_v1', { p_order_id: orderId, p_customer_id: customerId });
export const redeemPoints = (eventId: string, customerId: string, points: number, note?: string) =>
  rpc<Customer>('redeem_points_v1', { p_event_id: eventId, p_customer_id: customerId, p_points: points, p_note: note ?? null });
export const updateLoyalty = (businessId: string, vndPerPoint: number) =>
  rpc<Business>('update_loyalty_settings_v1', { p_business_id: businessId, p_vnd_per_point: vndPerPoint });

export async function loyaltyEvents(customerId: string): Promise<LoyaltyEvent[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('loyalty_events')
        .select('id, customer_id, order_id, kind, points, note, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50)
        .abortSignal(signal),
    ) as LoyaltyEvent[],
  );
}

// ---------- Thu nợ bằng mã QR ----------
export const createDebtPaymentOrder = (orderId: string, customerId: string, amount: number, deviceId: string | null) =>
  rpc<Order>('create_debt_payment_order_v1', { p_order_id: orderId, p_customer_id: customerId, p_amount: amount, p_device_id: deviceId });

// ---------- Hóa đơn điện tử ----------
export const INVOICE_COLS = 'id, business_id, order_id, form_no, symbol, invoice_no, status, buyer_name, buyer_tax_code, buyer_email, total_amount, issued_at, tax_authority_code, lookup_url';

export const updateInvoiceSettings = (businessId: string, provider: EinvoiceProvider, formNo: '1' | '2', symbol: string) =>
  rpc<Business>('update_invoice_settings_v1', { p_business_id: businessId, p_provider: provider, p_form_no: formNo, p_symbol: symbol });

export const createInvoiceFromOrder = (p: { invoiceId: string; orderId: string; buyerName?: string; buyerTaxCode?: string; buyerEmail?: string }) =>
  rpc<Invoice>('create_invoice_from_order_v1', {
    p_invoice_id: p.invoiceId, p_order_id: p.orderId, p_buyer_name: p.buyerName || null,
    p_buyer_tax_code: p.buyerTaxCode || null, p_buyer_email: p.buyerEmail || null, p_buyer_address: null,
  });

/** Phát hành qua Edge Function issue-einvoice (nhà cung cấp chỉ gọi từ server). */
export async function issueEinvoice(invoiceId: string): Promise<Invoice> {
  return callWithRetry(async () => {
    const { data, error } = await supabase.functions.invoke('issue-einvoice', { body: { invoice_id: invoiceId } });
    if (error) {
      // Lỗi từ Edge Function: thân trả về { error: 'QP_…' }
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      const body = ctx?.json ? await ctx.json().catch(() => null) : null;
      throw toAppError({ message: body?.error ?? (error as { message?: string }).message ?? 'UNKNOWN' });
    }
    return data as Invoice;
  });
}

export async function invoiceForOrder(orderId: string): Promise<Invoice | null> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('invoices')
        .select(INVOICE_COLS)
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .abortSignal(signal)
        .maybeSingle(),
    ) as Invoice | null,
  );
}

export async function recentInvoices(businessId: string): Promise<Invoice[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('invoices')
        .select(INVOICE_COLS)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(30)
        .abortSignal(signal),
    ) as Invoice[],
  );
}

// ---------- Danh mục (migration 9) ----------
export async function listCategories(businessId: string): Promise<Category[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase.from('product_categories').select('id, business_id, name, sort_order, tax_group, track_expiry_default')
        .eq('business_id', businessId).is('archived_at', null)
        .order('sort_order', { ascending: true }).order('name', { ascending: true }).abortSignal(signal),
    ) as Category[],
  );
}
export const upsertCategory = (c: { categoryId: string; businessId: string; name: string; sortOrder?: number; taxGroup?: TaxGroup | null; trackExpiryDefault?: boolean }) =>
  rpc<Category>('upsert_category_v1', {
    p_category_id: c.categoryId, p_business_id: c.businessId, p_name: c.name, p_sort_order: c.sortOrder ?? null,
    p_tax_group: c.taxGroup ?? null, p_track_expiry_default: !!c.trackExpiryDefault,
  });
export const archiveCategory = (categoryId: string) => rpc<Category>('archive_category_v1', { p_category_id: categoryId });

// ---------- Nhà cung cấp, phiếu nhập, công nợ ----------
export async function listSuppliers(businessId: string): Promise<Supplier[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase.from('suppliers').select('id, business_id, name, phone, address, tax_code, note')
        .eq('business_id', businessId).is('archived_at', null).order('name', { ascending: true }).abortSignal(signal),
    ) as Supplier[],
  );
}
export const upsertSupplier = (s: { supplierId: string; businessId: string; name: string; phone?: string | null; address?: string | null; taxCode?: string | null; note?: string | null }) =>
  rpc<Supplier>('upsert_supplier_v1', {
    p_supplier_id: s.supplierId, p_business_id: s.businessId, p_name: s.name, p_phone: s.phone || null, p_address: s.address || null,
    p_tax_code: s.taxCode || null, p_note: s.note || null,
  });
export const archiveSupplier = (supplierId: string) => rpc<Supplier>('archive_supplier_v1', { p_supplier_id: supplierId });
export const supplierBalances = (businessId: string) => rpc<SupplierBalance[]>('supplier_balances', { p_business_id: businessId });
export const supplierDetail = (supplierId: string) => rpc<SupplierDetail>('supplier_detail', { p_supplier_id: supplierId });
export const productSuppliers = (productId: string) => rpc<ProductSupplier[]>('product_suppliers', { p_product_id: productId });
export const createPurchase = (p: {
  purchaseId: string; businessId: string; supplierId: string | null; lines: PurchaseLineInput[]; paidAmount: number; recordExpense: boolean;
  note?: string | null; purchasedOn?: string;
}) =>
  rpc<Purchase>('create_purchase_v1', {
    p_purchase_id: p.purchaseId, p_business_id: p.businessId, p_supplier_id: p.supplierId, p_lines: p.lines, p_paid_amount: p.paidAmount,
    p_record_expense: p.recordExpense, p_note: p.note ?? null, p_purchased_on: p.purchasedOn ?? null,
  });
export const paySupplier = (p: { paymentId: string; supplierId: string; amount: number; note?: string | null; recordExpense: boolean }) =>
  rpc<SupplierPayment>('pay_supplier_v1', {
    p_payment_id: p.paymentId, p_supplier_id: p.supplierId, p_amount: p.amount, p_note: p.note ?? null, p_record_expense: p.recordExpense,
  });
export const voidSupplierPayment = (paymentId: string) => rpc<SupplierPayment>('void_supplier_payment_v1', { p_payment_id: paymentId });

// ---------- Kiểm kê ----------
export async function listStockCounts(businessId: string): Promise<StockCount[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase.from('stock_counts').select('id, business_id, status, note, started_at, finished_at, lines_total, lines_diff, value_diff')
        .eq('business_id', businessId).order('started_at', { ascending: false }).limit(50).abortSignal(signal),
    ) as StockCount[],
  );
}
export const startStockCount = (countId: string, businessId: string, note?: string | null) =>
  rpc<StockCount>('start_stock_count_v1', { p_count_id: countId, p_business_id: businessId, p_note: note ?? null });
export const countLine = (countId: string, productId: string, countedQty: number) =>
  rpc<StockCountLine>('count_line_v1', { p_count_id: countId, p_product_id: productId, p_counted_qty: countedQty });
export const finishStockCount = (countId: string) => rpc<StockCount>('finish_stock_count_v1', { p_count_id: countId });
export const cancelStockCount = (countId: string) => rpc<StockCount>('cancel_stock_count_v1', { p_count_id: countId });
export const stockCountDetail = (countId: string) => rpc<StockCountDetail>('stock_count_detail', { p_count_id: countId });

// ---------- Thông báo doanh thu (mẫu 01/TKN-CNKD) ----------
export const revenueNotice = (businessId: string, fromDay: string, toDay: string) =>
  rpc<RevenueNotice>('revenue_notice', { p_business_id: businessId, p_from_day: fromDay, p_to_day: toDay });
