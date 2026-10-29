import { Linking, View } from 'react-native';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { callSupport } from '../src/components/States';
import { lastVersionCheck } from '../src/features/session/bootstrap';
import { ENV } from '../src/lib/env';
import { space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 7.3 Bắt buộc cập nhật — không có đường đi tiếp. */
export default function CapNhat() {
  const v = lastVersionCheck;
  return (
    <Screen
      footer={
        <>
          <Button big label={vi.version.updateNow} disabled={!v?.store_url} onPress={() => v?.store_url && void Linking.openURL(v.store_url)} />
          <Button kind="secondary" label={vi.version.callHelp} onPress={callSupport} />
        </>
      }
    >
      <Txt variant="heading" style={{ marginTop: space.lg }}>
        {vi.version.title}
      </Txt>
      <Txt tone="secondary">{vi.version.body}</Txt>
      <Card style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1 }}>
          <Txt variant="small" tone="secondary">
            {vi.version.current}
          </Txt>
          <Txt variant="title">{ENV.appVersion}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="small" tone="secondary">
            {vi.version.latest}
          </Txt>
          <Txt variant="title" tone="success">
            {v?.latest_version ?? ''}
          </Txt>
        </View>
      </Card>
      <Txt variant="small" tone="secondary">
        {vi.version.queueSafe}
      </Txt>
    </Screen>
  );
}
