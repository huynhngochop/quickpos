/** Chi tiêu, sổ nợ, ngành nghề tính thuế — chỉ các lời gọi có trong docs/api.md (migration 6). */
import { supabase } from '../../lib/supabase';
import { callWithRetry, unwrap } from '../../lib/retry';
import type { Business, DebtBalance, DebtEntry, ExpenseRow } from '../../types/api';
import type { TaxIndustry } from '../tax/taxEstimate';

// ---------- Chi tiêu ----------
export async function listExpenses(businessId: string, from: string, to: string): Promise<ExpenseRow[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('journal_entries')
        .select('id, source_id, amount, category, description, entry_date, created_at')
        .eq('business_id', businessId)
        .eq('entry_type', 'EXPENSE')
        .is('voided_at', null)
        .gte('entry_date', from)
        .lte('entry_date', to)
        .order('entry_date', { ascending: false })
        .limit(500)
        .abortSignal(signal),
    ) as ExpenseRow[],
  );
}

export async function addExpense(p: { entryId: string; businessId: string; amount: number; category: string; note?: string; day?: string }) {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('add_expense_v1', {
          p_entry_id: p.entryId,
          p_business_id: p.businessId,
          p_amount: p.amount,
          p_category: p.category,
          p_note: p.note ?? null,
          p_entry_date: p.day ?? null,
        })
        .abortSignal(signal),
    ),
  );
}

export async function voidExpense(businessId: string, entryId: string) {
  return callWithRetry(async (signal) =>
    unwrap(await supabase.rpc('void_expense_v1', { p_business_id: businessId, p_entry_id: entryId }).abortSignal(signal)),
  );
}

// ---------- Sổ nợ ----------
export async function listDebtors(businessId: string): Promise<DebtBalance[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('debt_balances')
        .select('customer_id, business_id, name, phone, balance, last_entry_at')
        .eq('business_id', businessId)
        .order('balance', { ascending: false })
        .limit(500)
        .abortSignal(signal),
    ) as DebtBalance[],
  );
}

export async function listDebtEntries(customerId: string): Promise<DebtEntry[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('debt_entries')
        .select('id, customer_id, kind, amount, note, entry_date, created_at, voided_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(200)
        .abortSignal(signal),
    ) as DebtEntry[],
  );
}

export async function addDebtCustomer(p: { customerId: string; businessId: string; name: string; phone?: string; phoneConsent: boolean }) {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('add_debt_customer_v1', {
          p_customer_id: p.customerId,
          p_business_id: p.businessId,
          p_name: p.name,
          p_phone: p.phone || null,
          p_phone_consent: p.phoneConsent,
        })
        .abortSignal(signal),
    ),
  );
}

export async function recordDebt(p: { entryId: string; customerId: string; kind: 'DEBT' | 'PAYMENT'; amount: number; note?: string }) {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('record_debt_v1', { p_entry_id: p.entryId, p_customer_id: p.customerId, p_kind: p.kind, p_amount: p.amount, p_note: p.note ?? null })
        .abortSignal(signal),
    ),
  );
}

export async function voidDebtEntry(entryId: string) {
  return callWithRetry(async (signal) => unwrap(await supabase.rpc('void_debt_entry_v1', { p_entry_id: entryId }).abortSignal(signal)));
}

// ---------- Thuế ----------
export async function updateTaxIndustry(businessId: string, industry: TaxIndustry): Promise<Business> {
  return callWithRetry(async (signal) =>
    unwrap(await supabase.rpc('update_tax_settings_v1', { p_business_id: businessId, p_tax_industry: industry }).abortSignal(signal)) as Business,
  );
}
