/**
 * Chạy máy chủ quán trên máy chính (gói Pro, chế độ lưu trên máy). Một bản duy nhất cho cả app.
 * Bật khi quán có gói Pro còn hạn và (đã có máy nhân viên ghép, hoặc đang mở ghép máy).
 * Android: dịch vụ chạy nền có thông báo cố định (modules/qp-foreground) giữ app sống khi tắt màn hình; chỉ giữ CPU + Wi‑Fi
 * thức khi có máy nhân viên đang nối. Giữ màn hình sáng là tùy chọn thêm.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LanHost, type LanDevice } from './host';
import { LAN_PORT, randomKey } from './protocol';
import { listen, wifiIp } from './tcp';
import { readHostState, saveHostState, planNow } from './deviceMode';
import { addLanMember, hostExecute, onAnyOrder, removeLanMember } from '../../lib/demoClient';
import { supabase } from '../../lib/supabase';
import { planStatus } from '../plan/license';
import type { PlanRow } from '../plan/types';
import { usePrefs } from '../settings/prefs';
import { foregroundOff, foregroundOn } from './foreground';

interface HostState {
  hostId: string;
  devices: LanDevice[];
}

let host: LanHost | null = null;
let server: { close: () => void } | null = null;
let offOrders: (() => void) | null = null;
let shop: { businessId: string; name: string } | null = null;
let plan: PlanRow = { trialStartedAt: null, licenseCode: null };
let awake = false;

function state(): HostState {
  const s = readHostState<HostState>();
  if (s?.hostId) return s;
  const fresh = { hostId: randomKey().replace(/[^A-Za-z0-9]/g, '').slice(0, 16), devices: [] };
  saveHostState(fresh);
  return fresh;
}

const planActive = () => !!shop && planStatus({ businessId: shop.businessId, ...plan, now: planNow() }).active;

export function getHost(): LanHost {
  if (host) return host;
  const st = state();
  host = new LanHost({
    hostId: st.hostId,
    shop: () => shop,
    planActive,
    loadDevices: () => state().devices,
    saveDevices: (devices) => saveHostState({ ...state(), devices }),
    addMember: addLanMember,
    removeMember: removeLanMember,
    execute: (userId, req) =>
      hostExecute(userId, req as never, (name, opts) => supabase.functions.invoke(name, opts as never) as never),
  });
  host.subscribe(() => {
    void keepAwake();
    if (server) foregroundOn(host?.connectedCount() ?? 0);
  });
  return host;
}

async function keepAwake() {
  const want = (host?.connectedCount() ?? 0) > 0 && usePrefs.getState().hostKeepAwake;
  if (want === awake) return;
  awake = want;
  try {
    if (want) await activateKeepAwakeAsync('quickpos-lan');
    else deactivateKeepAwake('quickpos-lan');
  } catch {
    /* máy không hỗ trợ: bỏ qua */
  }
}

/** Cập nhật quán + gói rồi bật / tắt máy chủ cho khớp. Gọi khi mở trang chính và khi gói đổi. */
export function syncHost(next: { businessId: string; name: string } | null, nextPlan: PlanRow, forcePairing = false) {
  shop = next;
  plan = nextPlan;
  const h = getHost();
  const want = !!shop && planActive() && (forcePairing || h.list().length > 0);
  if (want && !server) {
    server = listen(LAN_PORT, (c) => h.attach(c));
    offOrders = onAnyOrder((row) => h.broadcastOrder(row));
  }
  // Android: dịch vụ chạy nền để máy chủ quán không bị dừng khi tắt màn hình (thử lại mỗi lần mở trang chính)
  if (want) foregroundOn(h.connectedCount(), true);
  if (!want && server) stopHost();
}

export function stopHost() {
  server?.close();
  server = null;
  offOrders?.();
  offOrders = null;
  foregroundOff();
  void keepAwake();
}

export const hostRunning = () => server !== null;
/** Đổi tùy chọn giữ màn hình sáng: áp dụng ngay */
export const refreshKeepAwake = () => void keepAwake();
export const hostIp = wifiIp;
export const HOST_PORT = LAN_PORT;
export const hostIdNow = () => state().hostId;
