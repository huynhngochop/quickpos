/**
 * Gói Pro trên máy (chế độ lưu trên máy). Bản có máy chủ (Premium) sẽ đọc gói từ máy chủ — chưa làm.
 */
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../lib/retry';
import type { PlanRow } from './types';

export async function readPlan(businessId: string): Promise<PlanRow> {
  const r = await supabase.from('businesses').select('id, pro_trial_started_at, pro_license').eq('id', businessId).maybeSingle();
  const row = unwrap(r) as { pro_trial_started_at?: string | null; pro_license?: string | null } | null;
  return { trialStartedAt: row?.pro_trial_started_at ?? null, licenseCode: row?.pro_license ?? null };
}

export async function startProTrial(businessId: string): Promise<PlanRow> {
  const r = unwrap(await supabase.rpc('start_pro_trial_v1', { p_business_id: businessId })) as { pro_trial_started_at: string | null; pro_license: string | null };
  return { trialStartedAt: r.pro_trial_started_at, licenseCode: r.pro_license };
}

export async function activateLicense(businessId: string, code: string): Promise<PlanRow> {
  const r = unwrap(await supabase.rpc('set_pro_license_v1', { p_business_id: businessId, p_code: code.trim() })) as {
    pro_trial_started_at: string | null;
    pro_license: string | null;
  };
  return { trialStartedAt: r.pro_trial_started_at, licenseCode: r.pro_license };
}
