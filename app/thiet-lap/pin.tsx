import { useState } from 'react';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { PinPad } from '../../src/components/PinPad';
import { saveOwnerPin } from '../../src/features/settings/pinStore';
import { isPinTooEasy } from '../../src/features/settings/pinLogic';
import { afterEnter } from '../../src/features/session/bootstrap';
import { vi } from '../../src/i18n/vi';

/** Bước 3/3 — Tạo mã PIN chủ quán: nhập 2 lần. */
export default function ThietLapPin() {
  const [first, setFirst] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const onComplete = async (pin: string) => {
    if (first === null) {
      if (isPinTooEasy(pin)) return setMsg(vi.setup.pinTooEasy);
      setMsg(null);
      return setFirst(pin);
    }
    if (pin !== first) {
      setFirst(null);
      return setMsg(vi.setup.pinMismatch);
    }
    await saveOwnerPin(pin);
    void afterEnter();
    router.replace('/trang-chinh');
  };

  return (
    <Screen>
      <Txt variant="bodyStrong" tone="secondary">
        {vi.setup.step(3)}
      </Txt>
      <Txt variant="heading">{first === null ? vi.setup.pinTitle : vi.setup.pinRepeat}</Txt>
      <Txt tone="secondary">{vi.setup.pinBody}</Txt>
      {msg ? (
        <Txt tone="danger" variant="bodyStrong" accessibilityLiveRegion="assertive">
          {msg}
        </Txt>
      ) : null}
      <PinPad onComplete={(p) => void onComplete(p)} />
    </Screen>
  );
}
