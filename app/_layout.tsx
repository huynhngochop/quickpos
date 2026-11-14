import { useEffect } from 'react';
import { AppState, useWindowDimensions, View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  BeVietnamPro_400Regular,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
  BeVietnamPro_800ExtraBold,
} from '@expo-google-fonts/be-vietnam-pro';
import { queryClient } from '../src/lib/queryClient';
import { startNetWatch } from '../src/lib/net';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme/tokens';
import { layoutFor } from '../src/theme/layout';
import { useSession } from '../src/features/session/store';
import { useBusinessRealtime } from '../src/features/sale/realtime';
import { flushNow } from '../src/features/offline/useQueue';
import { PaidFlash } from '../src/components/PaidFlash';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { vi } from '../src/i18n/vi';
import { qaLog, startQaHeartbeat } from '../src/lib/qaLog';
import { useDoubleBackExit } from '../src/lib/backPress';

void SplashScreen.preventAutoHideAsync();
startQaHeartbeat();

// Lỗi JS ngoài lúc vẽ (bấm nút, hẹn giờ): ghi ra nhật ký máy (logcat "[QP]") để QA đọc được, rồi giao lại cho bộ xử lý mặc định
type ErrorUtilsT = { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
const EU = (globalThis as { ErrorUtils?: ErrorUtilsT }).ErrorUtils;
if (EU) {
  const prev = EU.getGlobalHandler();
  EU.setGlobalHandler((e, fatal) => {
    qaLog('lỗi JS', fatal ? 'fatal' : '', e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e));
    prev(e, fatal);
  });
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
    BeVietnamPro_800ExtraBold,
  });
  const businessId = useSession((s) => s.business?.id ?? null);
  const { width, height } = useWindowDimensions();
  const lockPortrait = layoutFor(width, height).lockPortrait;
  // Android: bấm quay lại 1 lần về màn trước, 2 lần liên tiếp thoát app
  useDoubleBackExit();

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Điện thoại khóa dọc; màn ≥ 600dp cho xoay (Android 16 cũng bỏ qua khóa trên màn lớn)
  useEffect(() => {
    void (lockPortrait
      ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
      : ScreenOrientation.unlockAsync());
  }, [lockPortrait]);

  useEffect(() => {
    startNetWatch(() => void flushNow());
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void flushNow();
    });
    // Làm mới phiên thất bại (token hết hạn hẳn) → màn "Cần đăng nhập lại", hàng đợi vẫn giữ
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && useSession.getState().everSignedIn) router.replace('/het-phien');
    });
    return () => {
      app.remove();
      data.subscription.unsubscribe();
    };
  }, []);

  useBusinessRealtime(businessId);

  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: colors.ground }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground }, animation: 'fade' }} />
          <PaidFlash />
        </View>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * Lỗi bất ngờ khi vẽ màn hình: hiện màn báo lỗi bằng chữ + nút mở lại, thay vì app tự đóng.
 * Dữ liệu đã lưu trên máy sau mỗi thao tác nên mở lại không mất đơn.
 */
export function ErrorBoundary({ retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.ground }}>
      <Txt variant="heading">{vi.crash.title}</Txt>
      <Txt>{vi.crash.body}</Txt>
      <Button
        big
        label={vi.crash.retry}
        onPress={() => {
          void retry();
          router.replace('/');
        }}
      />
    </View>
  );
}
