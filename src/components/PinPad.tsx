import { useState } from 'react';
import { View } from 'react-native';
import { Keypad, PinDots } from './Keypad';
import { touch, space } from '../theme/tokens';
import { PIN_LENGTH } from '../features/settings/pinLogic';

/** Nhập 4 số; đủ 4 số thì gọi onComplete rồi xóa trắng. Phím "000" bị bỏ qua. */
export function PinPad({ onComplete }: { onComplete: (pin: string) => void }) {
  const [pin, setPin] = useState('');
  return (
    <View style={{ gap: space.xl }}>
      <PinDots length={PIN_LENGTH} filled={pin.length} />
      <Keypad
        keyHeight={touch.key}
        onKey={(k) => {
          if (k === 'del') return setPin((p) => p.slice(0, -1));
          if (k === 'clear' || k === '000') return;
          const next = (pin + k).slice(0, PIN_LENGTH);
          setPin(next);
          if (next.length === PIN_LENGTH) {
            setPin('');
            onComplete(next);
          }
        }}
      />
    </View>
  );
}
