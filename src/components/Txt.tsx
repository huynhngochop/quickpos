import { Text, type TextProps, type TextStyle } from 'react-native';
import { colors, font } from '../theme/tokens';
import { fontFactor, usePrefs } from '../features/settings/prefs';

type Variant = 'caption' | 'small' | 'body' | 'bodyStrong' | 'button' | 'title' | 'heading';
type Tone = 'ink' | 'secondary' | 'primary' | 'success' | 'warn' | 'danger' | 'onColor';

const VARIANT: Record<Variant, TextStyle> = {
  caption: { fontSize: font.size.caption, fontFamily: font.family.regular, lineHeight: font.size.caption * 1.45 },
  small: { fontSize: font.size.small, fontFamily: font.family.regular, lineHeight: font.size.small * 1.45 },
  body: { fontSize: font.size.body, fontFamily: font.family.regular, lineHeight: font.size.body * 1.5 },
  bodyStrong: { fontSize: font.size.bodyLarge, fontFamily: font.family.heavy, lineHeight: font.size.bodyLarge * 1.35 },
  button: { fontSize: font.size.button, fontFamily: font.family.heavy },
  title: { fontSize: font.size.title, fontFamily: font.family.heavy, lineHeight: font.size.title * 1.3 },
  heading: { fontSize: font.size.heading, fontFamily: font.family.heavy, lineHeight: font.size.heading * 1.25 },
};

const TONE: Record<Tone, string> = {
  ink: colors.ink,
  secondary: colors.secondary,
  primary: colors.primary,
  success: colors.successText,
  warn: colors.warnText,
  danger: colors.danger,
  onColor: colors.onColor,
};

export interface TxtProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  center?: boolean;
}

/** Mọi chữ trong app đi qua đây: cỡ chữ lấy từ theme, nhân cỡ chữ người dùng chọn, KHÔNG tắt chữ lớn hệ thống. */
export function Txt({ variant = 'body', tone = 'ink', center, style, ...rest }: TxtProps) {
  const factor = fontFactor(usePrefs((s) => s.fontChoice));
  const base = VARIANT[variant];
  const scaled: TextStyle = {
    ...base,
    fontSize: (base.fontSize ?? font.size.body) * factor,
    lineHeight: base.lineHeight ? base.lineHeight * factor : undefined,
    color: TONE[tone],
    textAlign: center ? 'center' : undefined,
  };
  return <Text {...rest} style={[scaled, style]} />;
}

/** Số tiền cỡ lớn: luôn một dòng, tự thu nhỏ cho vừa, phóng tối đa 1.3 lần theo chữ hệ thống. */
export function Amount({
  value,
  size = font.size.amount,
  tone = 'ink',
  center = true,
}: {
  value: string;
  size?: number;
  tone?: Tone;
  center?: boolean;
}) {
  return (
    <Text
      accessibilityRole="text"
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.5}
      maxFontSizeMultiplier={font.amountMaxScale}
      style={{
        fontSize: size,
        fontFamily: font.family.heavy,
        color: TONE[tone],
        textAlign: center ? 'center' : 'left',
        fontVariant: ['tabular-nums'],
      }}
    >
      {value}
    </Text>
  );
}
