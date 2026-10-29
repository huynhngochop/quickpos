import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { colors, radius, touch } from '../theme/tokens';
import { Txt } from './Txt';

type Kind = 'primary' | 'secondary' | 'success' | 'danger' | 'dangerOutline' | 'link';

const STYLE: Record<Kind, { bg: string; fg: 'onColor' | 'ink' | 'primary' | 'danger'; border?: string }> = {
  primary: { bg: colors.primary, fg: 'onColor' },
  secondary: { bg: colors.surface, fg: 'ink', border: colors.ink },
  success: { bg: colors.success, fg: 'onColor' },
  danger: { bg: colors.danger, fg: 'onColor' },
  dangerOutline: { bg: 'transparent', fg: 'danger', border: colors.danger },
  link: { bg: 'transparent', fg: 'primary' },
};

export interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: Kind;
  /** Nút chính của màn hình cao hơn */
  big?: boolean;
  disabled?: boolean;
  /** Chữ thay thế khi chưa bấm được (thay vì nút xám không lời) */
  disabledLabel?: string;
  busy?: boolean;
  icon?: ReactNode;
  hint?: string;
  style?: ViewStyle;
}

/** Nút có chữ, cao ≥ 56dp. Không có nút chỉ có biểu tượng. */
export function Button({ label, onPress, kind = 'primary', big, disabled, disabledLabel, busy, icon, hint, style }: ButtonProps) {
  const s = STYLE[kind];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={disabled && disabledLabel ? disabledLabel : label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: big ? touch.primary : touch.min,
          borderRadius: big ? radius.lg : radius.md,
          backgroundColor: disabled ? colors.disabledBg : s.bg,
          borderWidth: s.border && !disabled ? 2 : 0,
          borderColor: s.border,
          paddingHorizontal: 16,
          paddingVertical: 10,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 10,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={s.fg === 'onColor' ? colors.onColor : colors.ink} /> : icon ? <View>{icon}</View> : null}
      <Txt variant="button" tone={disabled ? 'secondary' : s.fg} center style={kind === 'link' ? { fontSize: 18 } : undefined}>
        {disabled && disabledLabel ? disabledLabel : label}
      </Txt>
    </Pressable>
  );
}
