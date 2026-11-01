import { Pressable } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, radius, touch } from '../theme/tokens';

type IconName = 'settings' | 'exit';

/**
 * Nút hình biểu tượng ở góc trên trang chính (Cài đặt, Thoát) — theo góp ý người dùng thử 01/11/2026.
 * Vùng bấm ≥ 56dp, viền rõ, luôn có accessibilityLabel bằng chữ để trình đọc màn hình và kiểm thử tìm được.
 */
export function IconButton({ name, label, onPress, testID }: { name: IconName; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: touch.min,
        height: touch.min,
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.divider : colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      {name === 'settings' ? <GearIcon /> : <ExitIcon />}
    </Pressable>
  );
}

const SIZE = 30;

function GearIcon() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.3 2.6h3.4l.5 2.6a7.5 7.5 0 0 1 1.9 1.1l2.5-.9 1.7 2.9-2 1.7a7.6 7.6 0 0 1 0 2.2l2 1.7-1.7 2.9-2.5-.9a7.5 7.5 0 0 1-1.9 1.1l-.5 2.6h-3.4l-.5-2.6a7.5 7.5 0 0 1-1.9-1.1l-2.5.9-1.7-2.9 2-1.7a7.6 7.6 0 0 1 0-2.2l-2-1.7 1.7-2.9 2.5.9a7.5 7.5 0 0 1 1.9-1.1z"
        stroke={colors.ink}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3} stroke={colors.ink} strokeWidth={2} />
    </Svg>
  );
}

function ExitIcon() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
      <Path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
      <Path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" stroke={colors.danger} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
