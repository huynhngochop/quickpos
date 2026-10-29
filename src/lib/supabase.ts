/**
 * Client Supabase duy nhất của app. Chỉ anon key; mọi quyền do RLS và hàm *_v1 quyết định.
 * Phiên đăng nhập lưu trong AsyncStorage (SecureStore giới hạn 2 KB, không đủ cho phiên).
 * Sau khi sinh src/types/database.ts: đổi thành createClient<Database>(…).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { ENV } from './env';
import { createDemoClient } from './demoClient';

const realClient = () => createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: { params: { eventsPerSecond: 5 } },
});

// Thiếu địa chỉ máy chủ (APK xem thử) → chế độ dùng thử với dữ liệu mẫu trong máy
export const supabase: ReturnType<typeof realClient> = ENV.demo
  ? (createDemoClient() as unknown as ReturnType<typeof realClient>)
  : realClient();

// Chỉ làm mới token khi app đang mở (theo hướng dẫn Supabase cho React Native)
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
