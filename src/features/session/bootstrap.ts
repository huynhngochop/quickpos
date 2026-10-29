/**
 * Trình tự khi mở app (docs/api.md mục 2), trả về màn hình cần mở.
 * Mất mạng mà máy đã có quán trong bộ nhớ → vẫn vào trang chính (thu tiền mặt được).
 */
import { supabase } from '../../lib/supabase';
import { getDeviceId } from '../../lib/device';
import { toAppError } from '../../lib/errors';
import { ENV } from '../../lib/env';
import { useSession } from './store';
import { checkAppVersion, hasConsent, myMemberships, registerDevice } from './api';
import { hasOwnerPin } from '../settings/pinStore';
import { usePrefs } from '../settings/prefs';
import { getPushToken, ensurePaymentChannel } from '../notifications/setup';
import { flushNow, refreshQueue } from '../offline/useQueue';
import type { AppVersionCheck } from '../../types/api';

export type Route =
  | { to: '/cap-nhat'; version: AppVersionCheck }
  | { to: '/dang-nhap' }
  | { to: '/het-phien' }
  | { to: '/dong-y' }
  | { to: '/thiet-lap/quan' }
  | { to: '/thiet-lap/pin' }
  | { to: '/trang-chinh' };

export let lastVersionCheck: AppVersionCheck | null = null;

/** Đợi zustand đọc xong dữ liệu đã lưu (AsyncStorage là bất đồng bộ). */
function hydrated(store: { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }): Promise<void> {
  if (store.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = store.persist.onFinishHydration(() => {
      off();
      resolve();
    });
  });
}

export async function bootstrap(): Promise<Route> {
  await Promise.all([hydrated(useSession), hydrated(usePrefs)]);
  await getDeviceId();
  await refreshQueue();
  void ensurePaymentChannel();

  // 1. Phiên bản: lỗi mạng thì bỏ qua, không chặn bán tiền mặt
  try {
    const v = await checkAppVersion();
    lastVersionCheck = v;
    if (v?.must_update) return { to: '/cap-nhat', version: v };
  } catch {
    /* mất mạng */
  }

  // 2. Phiên đăng nhập (đọc từ máy, không cần mạng)
  const { data } = await supabase.auth.getSession();
  const session = useSession.getState();
  if (!data.session) return session.everSignedIn ? { to: '/het-phien' } : { to: '/dang-nhap' };
  const userId = data.session.user.id;
  if (session.userId && session.userId !== userId) session.reset();
  useSession.getState().set({ userId, everSignedIn: true });

  try {
    // 3. Đồng ý xử lý dữ liệu theo phiên bản chính sách hiện tại
    if (useSession.getState().consentVersion !== ENV.policyVersion) {
      if (!(await hasConsent(userId))) return { to: '/dong-y' };
      useSession.getState().set({ consentVersion: ENV.policyVersion });
    }
    // 4. Quán
    const members = await myMemberships(userId);
    if (members.length === 0) return { to: '/thiet-lap/quan' };
    const keep = members.find((m) => m.business.id === useSession.getState().business?.id) ?? members[0]!;
    useSession.getState().set({ business: keep.business, role: keep.role });
  } catch (raw) {
    const err = toAppError(raw);
    if (err.code === 'QP_UNAUTHENTICATED') return { to: '/het-phien' };
    if (!useSession.getState().business) throw err;   // lần đầu mà mất mạng: màn hình báo lỗi + thử lại
  }

  // 5. Chủ quán cần PIN trên máy này
  if (useSession.getState().role === 'OWNER' && !(await hasOwnerPin())) return { to: '/thiet-lap/pin' };

  // 6. Đăng ký máy + gửi đơn chờ (không chặn mở app)
  void afterEnter();
  return { to: '/trang-chinh' };
}

export async function afterEnter(): Promise<void> {
  const { business } = useSession.getState();
  try {
    await registerDevice({
      deviceId: await getDeviceId(),
      businessId: business?.id ?? null,
      pushToken: await getPushToken(),
      speak: usePrefs.getState().speak,
    });
  } catch {
    /* lần mở sau đăng ký lại */
  }
  await flushNow();
}
