import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors, space } from '../theme/tokens';
import { Txt } from './Txt';
import { vi } from '../i18n/vi';

/**
 * Khung màn hình: nền, vùng an toàn (vẽ tràn viền là mặc định), cuộn khi chữ lớn.
 * `footer` dính đáy, đã cộng phần dưới vùng an toàn để nút không nằm dưới thanh cử chỉ.
 * Bàn phím mở thì đẩy nội dung lên: vẽ tràn viền làm Android bỏ qua "resize" của cửa sổ,
 * nên ô nhập ở nửa dưới (máy tính bảng nằm ngang) bị bàn phím che nếu không có KeyboardAvoidingView.
 */
export function Screen({
  children,
  footer,
  back,
  scroll = true,
  bg = colors.ground,
  maxWidth,
  contentStyle,
}: {
  children: ReactNode;
  footer?: ReactNode;
  back?: { label: string; href?: string };
  scroll?: boolean;
  bg?: string;
  maxWidth?: number;
  contentStyle?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const inner: ViewStyle = {
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    gap: space.md,
    width: '100%',
    maxWidth,
    alignSelf: 'center',
    ...contentStyle,
  };
  const body = (
    <>
      {back ? <BackLink label={back.label} href={back.href} /> : null}
      {children}
    </>
  );
  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: bg, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, { paddingBottom: space.xl, flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[inner, { flex: 1 }]}>{body}</View>
      )}
      {footer ? (
        <View
          style={{
            paddingHorizontal: space.gutter,
            paddingTop: space.md,
            paddingBottom: space.lg + insets.bottom,
            gap: space.md,
            width: '100%',
            maxWidth,
            alignSelf: 'center',
            backgroundColor: bg,
          }}
        >
          {footer}
        </View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}
    </KeyboardAvoidingView>
  );
}

export function BackLink({ label = vi.common.back, href }: { label?: string; href?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => (href ? router.replace(href as never) : router.canGoBack() ? router.back() : router.replace('/trang-chinh'))}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingRight: 12 }}
    >
      <Txt variant="heading" tone="primary" style={{ lineHeight: undefined }}>
        ‹
      </Txt>
      <Txt variant="bodyStrong" tone="primary">
        {label}
      </Txt>
    </Pressable>
  );
}

export function Card({ children, style, tone = 'plain' }: { children: ReactNode; style?: ViewStyle; tone?: 'plain' | 'warn' | 'success' | 'danger' | 'info' }) {
  const t = {
    plain: { bg: colors.surface, border: colors.border },
    warn: { bg: colors.warnSoft, border: colors.warn },
    success: { bg: colors.successSoft, border: colors.success },
    danger: { bg: colors.dangerSoft, border: colors.danger },
    info: { bg: colors.primarySoft, border: colors.primary },
  }[tone];
  return (
    <View style={[{ backgroundColor: t.bg, borderColor: t.border, borderWidth: 2, borderRadius: 18, padding: 16, gap: 8 }, style]}>
      {children}
    </View>
  );
}
