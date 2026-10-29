import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { bootstrap } from '../src/features/session/bootstrap';
import { ErrorView, Loading } from '../src/components/States';
import { colors, space } from '../src/theme/tokens';
import { ENV } from '../src/lib/env';
import { vi } from '../src/i18n/vi';
import { Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';

/** Cổng vào: chạy trình tự mở app rồi chuyển tới đúng màn hình. */
export default function Gate() {
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(() => {
    setError(null);
    bootstrap()
      .then((r) => router.replace(r.to))
      .catch(setError);
  }, []);

  useEffect(() => {
    if (ENV.configured) run();
  }, [run]);

  if (!ENV.configured) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: space.gutter, backgroundColor: colors.ground }}>
        <Card tone="warn">
          <Txt variant="title" tone="warn">
            {vi.common.notConfiguredTitle}
          </Txt>
          <Txt tone="warn">{vi.common.notConfiguredBody}</Txt>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.gutter, backgroundColor: colors.ground }}>
      {error ? <ErrorView error={error} onRetry={run} /> : <Loading />}
    </View>
  );
}
