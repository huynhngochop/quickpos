/** Đăng nhập, đồng ý, quán, thiết bị — chỉ các lời gọi có trong docs/api.md. */
import { Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import { callWithRetry, unwrap } from '../../lib/retry';
import { toAppError } from '../../lib/errors';
import { ENV } from '../../lib/env';
import type { AppVersionCheck, Business, Membership, PaymentAccount, Role } from '../../types/api';

const platform = Platform.OS === 'ios' ? 'ios' : 'android';

export async function checkAppVersion(): Promise<AppVersionCheck | null> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('check_app_version_v1', { p_platform: platform, p_version: ENV.appVersion })
        .abortSignal(signal),
    ) as AppVersionCheck | null,
  );
}

export async function sendOtp(phoneE164: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 });
  if (error) throw toAppError(error);
}

export async function verifyOtp(phoneE164: string, token: string): Promise<string> {
  const { data, error } = await supabase.auth.verifyOtp({ phone: phoneE164, token, type: 'sms' });
  if (error || !data.user) throw toAppError(error ?? { message: 'QP_UNAUTHENTICATED' });
  return data.user.id;
}

export async function hasConsent(userId: string): Promise<boolean> {
  return callWithRetry(async (signal) => {
    const rows = unwrap(
      await supabase
        .from('user_consents')
        .select('policy_version')
        .eq('user_id', userId)
        .eq('policy_version', ENV.policyVersion)
        .limit(1)
        .abortSignal(signal),
    ) as { policy_version: string }[] | null;
    return (rows ?? []).length > 0;
  });
}

export async function recordConsent(): Promise<void> {
  await callWithRetry(async (signal) =>
    unwrap(await supabase.rpc('record_consent_v1', { p_policy_version: ENV.policyVersion, p_source: 'app' }).abortSignal(signal)),
  );
}

const BUSINESS_COLS = 'id, business_name, tax_code, address, allow_cashier_manual_confirm';

export async function myMemberships(userId: string): Promise<Membership[]> {
  return callWithRetry(async (signal) => {
    const rows = unwrap(
      await supabase
        .from('business_members')
        .select(`role, business:businesses(${BUSINESS_COLS})`)
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .abortSignal(signal),
    ) as unknown as { role: Role; business: Business | null }[];
    return rows.filter((r): r is Membership => r.business !== null);
  });
}

export async function createBusiness(args: { id: string; name: string; taxCode: string; address: string }): Promise<Business> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('create_business_v1', {
          p_business_id: args.id,
          p_business_name: args.name,
          p_tax_code: args.taxCode,
          p_address: args.address,
        })
        .abortSignal(signal),
    ) as Business,
  );
}

export async function registerDevice(args: {
  deviceId: string;
  businessId: string | null;
  pushToken: string | null;
  speak: boolean;
}): Promise<void> {
  await callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('register_device_v1', {
          p_device_id: args.deviceId,
          p_business_id: args.businessId,
          p_platform: platform,
          p_app_version: ENV.appVersion,
          p_push_token: args.pushToken,
          p_speak_payments: args.speak,
        })
        .abortSignal(signal),
    ),
  );
}

/** Tài khoản nhận tiền chính (null = chưa kết nối). Chỉ đọc — ghi do Edge Function của cổng. */
export async function mainPaymentAccount(businessId: string): Promise<PaymentAccount | null> {
  return callWithRetry(async (signal) => {
    const rows = unwrap(
      await supabase
        .from('payment_accounts')
        .select('id, business_id, provider, bank_bin, account_no, kind, label, is_active')
        .eq('business_id', businessId)
        .eq('kind', 'MAIN')
        .eq('is_active', true)
        .limit(1)
        .abortSignal(signal),
    ) as PaymentAccount[] | null;
    return rows?.[0] ?? null;
  });
}

export async function updateBusinessSettings(businessId: string, allowCashierManualConfirm: boolean): Promise<Business> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .rpc('update_business_settings_v1', {
          p_business_id: businessId,
          p_allow_cashier_manual_confirm: allowCashierManualConfirm,
        })
        .abortSignal(signal),
    ) as Business,
  );
}

export async function listMembers(businessId: string): Promise<{ user_id: string; role: Role }[]> {
  return callWithRetry(async (signal) =>
    unwrap(
      await supabase
        .from('business_members')
        .select('user_id, role')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true })
        .abortSignal(signal),
    ) as { user_id: string; role: Role }[],
  );
}

export async function requestAccountDeletion(): Promise<void> {
  await callWithRetry(async (signal) =>
    unwrap(await supabase.rpc('request_account_deletion_v1', { p_reason: null }).abortSignal(signal)),
  );
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
