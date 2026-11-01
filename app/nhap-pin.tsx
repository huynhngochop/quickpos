import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { PinPad } from '../src/components/PinPad';
import { SupportLink } from '../src/components/States';
import { hasOwnerPin, verifyOwnerPin } from '../src/features/settings/pinStore';
import { unlockOwner } from '../src/features/session/hooks';
import { vi } from '../src/i18n/vi';

const ALLOWED = ['/cai-dat', '/xem-lai', '/bao-cao', '/thue', '/hoa-don', '/nhan-vien'] as const;

/** 4.1 Nhập mã PIN chủ quán trước khi mở Cài đặt / Tiền cần xem lại. */
export default function NhapPin() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const target = ALLOWED.find((p) => p === next) ?? '/cai-dat';
  const [msg, setMsg] = useState<string | null>(null);

  // Máy chưa có PIN chủ quán (ví dụ máy của thu ngân): quyền do server quyết định, đi thẳng
  useEffect(() => {
    void hasOwnerPin().then((has) => {
      if (!has) {
        unlockOwner();
        router.replace(target);
      }
    });
  }, [target]);

  const onComplete = async (pin: string) => {
    const r = await verifyOwnerPin(pin);
    if (r.ok) {
      unlockOwner();
      router.replace(target);
    } else if (r.reason === 'locked') {
      setMsg(vi.pin.locked(r.retryInSec));
    } else {
      setMsg(vi.pin.wrong(r.triesLeft));
    }
  };

  return (
    <Screen back={{ label: vi.common.home }} footer={<SupportLink label={vi.pin.forgot} />}>
      <Txt variant="heading">{vi.pin.title}</Txt>
      <Txt tone="secondary">{vi.pin.enter}</Txt>
      {msg ? (
        <Txt tone="danger" variant="bodyStrong" accessibilityLiveRegion="assertive">
          {msg}
        </Txt>
      ) : null}
      <PinPad onComplete={(p) => void onComplete(p)} />
    </Screen>
  );
}
