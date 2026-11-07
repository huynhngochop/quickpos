/**
 * Client Supabase duy nhất của app. Chỉ anon key; mọi quyền do RLS và hàm *_v1 quyết định.
 * Phiên đăng nhập lưu trong AsyncStorage (SecureStore giới hạn 2 KB, không đủ cho phiên).
 * Sau khi sinh src/types/database.ts: đổi thành createClient<Database>(…).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { ENV } from './env';
import { attachStorage, createDemoClient, persistNow } from './demoClient';
import { localStore } from './localStore';
import { LanClient } from '../features/lan/client';
import { createLanSupabase } from '../features/lan/lanSupabase';
import { connect, scanForHost } from '../features/lan/tcp';
import { readStaffPairing, saveStaffPairing } from '../features/lan/deviceMode';
import type { StaffPairing } from '../features/lan/protocol';

const realClient = () => createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: { params: { eventsPerSecond: 5 } },
});

type Client = ReturnType<typeof realClient>;

// Thiếu địa chỉ máy chủ → dữ liệu nằm trên máy (src/lib/demoClient.ts), lưu bền trong SQLite của app
if (ENV.demo) attachStorage(localStore);
const localClient = ENV.demo ? (createDemoClient() as unknown as Client) : null;

// Gói Pro: máy nhân viên gửi mọi lệnh tới máy chủ quán trong Wi‑Fi (src/features/lan)
let lanClient: LanClient | null = null;
function staffClient(p: StaffPairing): Client {
  lanClient = new LanClient(p, connect, scanForHost, (ip) => saveStaffPairing({ ...p, hostIp: ip }));
  return createLanSupabase(lanClient, () => setStaffPairing(null)) as unknown as Client;
}

let current: Client = ENV.demo ? (readStaffPairing() ? staffClient(readStaffPairing()!) : localClient!) : realClient();

/** Bật / tắt chế độ máy nhân viên (ghép máy xong, hoặc ngắt khỏi máy chủ quán). Sau đó chạy lại cổng vào. */
export function setStaffPairing(p: StaffPairing | null) {
  saveStaffPairing(p);
  if (!p) {
    lanClient?.close();
    lanClient = null;
  }
  current = p ? staffClient(p) : localClient!;
}

/** Máy này đang là máy nhân viên nối vào máy chủ quán */
export const isStaffDevice = () => lanClient !== null;
export const currentLanClient = () => lanClient;

// Mọi nơi trong app dùng `supabase`; đối tượng này chuyển lời gọi tới client đang dùng
export const supabase: Client = ENV.demo
  ? (new Proxy({} as Client, { get: (_t, k) => (current as unknown as Record<string | symbol, unknown>)[k] }) as Client)
  : current;

// App vào nền / bị tắt: ghi ngay phần chưa lưu
if (ENV.demo && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') persistNow(true);
  });
}

// Chỉ làm mới token khi app đang mở (theo hướng dẫn Supabase cho React Native)
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
