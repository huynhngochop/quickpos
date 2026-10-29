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

void SplashScreen.preventAutoHideAsync();

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
