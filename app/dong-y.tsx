import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { Checkbox, ErrorView } from '../src/components/States';
import { recordConsent } from '../src/features/session/api';
import { useSession } from '../src/features/session/store';
import { ENV } from '../src/lib/env';
import { colors, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 7.1 Đồng ý xử lý dữ liệu (Luật BVDLCN 91/2025/QH15) — chủ quán tự đọc và bấm. */
export default function DongY() {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordConsent();
      useSession.getState().set({ consentVersion: ENV.policyVersion });
      router.replace('/');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          {error ? <ErrorView error={error} /> : null}
          <Button big label={vi.consent.accept} disabled={!agree} disabledLabel={vi.consent.needCheck} busy={busy} onPress={submit} />
          <Txt variant="small" tone="secondary" center>
            {vi.consent.staffNote}
          </Txt>
        </>
      }
    >
      <Txt variant="heading">{vi.consent.title}</Txt>
      {vi.consent.items.map((it, i) => (
        <Card key={it.title} style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="bodyStrong" tone="onColor" maxFontSizeMultiplier={1.2}>
              {String(i + 1)}
            </Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="bodyStrong">{it.title}</Txt>
            <Txt variant="small" tone="secondary">
              {it.body}
            </Txt>
          </View>
        </Card>
      ))}
      {ENV.policyUrl ? <Button kind="link" label={vi.consent.readFull} onPress={() => void Linking.openURL(ENV.policyUrl)} /> : null}
      <Checkbox label={vi.consent.checkbox} value={agree} onChange={setAgree} />
    </Screen>
  );
}
