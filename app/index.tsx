import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { bootstrap } from '../src/features/session/bootstrap';
import { ErrorView, Loading } from '../src/components/States';
import { colors, space } from '../src/theme/tokens';

/** Cổng vào: chạy trình tự mở app rồi chuyển tới đúng màn hình. */
export default function Gate() {
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(() => {
    setError(null);
    bootstrap()
      .then((r) => router.replace(r.to))
      .catch(setError);
  }, []);

  useEffect(run, [run]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.gutter, backgroundColor: colors.ground }}>
      {error ? <ErrorView error={error} onRetry={run} /> : <Loading />}
    </View>
  );
}
