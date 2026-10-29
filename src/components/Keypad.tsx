import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, space } from '../theme/tokens';
import { Txt } from './Txt';
import type { KeypadKey } from '../lib/money';
import { vi } from '../i18n/vi';

const ROWS: KeypadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['000', '0', 'del'],
];

const LABEL: Partial<Record<KeypadKey, string>> = { del: '⌫' };
const A11Y: Partial<Record<KeypadKey, string>> = { del: vi.common.deleteDigit, '000': vi.common.tripleZero };

/** Bàn phím số lớn có phím "000". Không dựa vào nhấn giữ hay vuốt. */
export function Keypad({ onKey, keyHeight }: { onKey: (k: KeypadKey) => void; keyHeight: number }) {
  return (
    <View style={{ gap: space.sm }}>
      {ROWS.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
          {row.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={A11Y[k] ?? k}
              testID={`key-${k}`}
              onPress={() => {
                void Haptics.selectionAsync();
                onKey(k);
              }}
              style={({ pressed }) => ({
                flex: 1,
                height: keyHeight,
                borderRadius: radius.sm,
                backgroundColor: pressed ? colors.divider : colors.surface,
                borderWidth: 2,
                borderColor: colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <Txt variant="heading" maxFontSizeMultiplier={1.3}>
                {LABEL[k] ?? k}
              </Txt>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Bàn phím 4 số cho mã PIN: hiện chấm thay số. */
export function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }} accessibilityLabel={`${filled} trên ${length} số`}>
      {Array.from({ length }, (_, i) => (
        <View
          key={i}
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: colors.ink,
            backgroundColor: i < filled ? colors.ink : 'transparent',
          }}
        />
      ))}
    </View>
  );
}
