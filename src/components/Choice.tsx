import { useId } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { colors, font, radius, space, touch } from '../theme/tokens';
import { Txt } from './Txt';
import { vi } from '../i18n/vi';

/**
 * Chọn một trong vài lựa chọn bằng nút to có chữ (không dùng menu thả xuống).
 * Đang chọn: nền xanh đậm + chữ trắng, viền và cỡ chữ giữ nguyên để không giật bố cục; trình đọc màn hình nhận trạng thái qua accessibilityState.selected.
 */
export function ChoiceGrid<K extends string>({
  options,
  value,
  onChange,
  columns = 2,
  testIdPrefix,
}: {
  options: readonly { key: K; label: string }[];
  value: K | null;
  onChange: (k: K) => void;
  columns?: number;
  testIdPrefix?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={testIdPrefix ? `${testIdPrefix}-${o.key}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => ({
              flexBasis: `${Math.floor(100 / columns) - 4}%`,
              flexGrow: 1,
              minHeight: touch.min,
              borderRadius: radius.md,
              // Viền và chữ giữ nguyên kích thước khi chọn → không xô lệch bố cục; ô đang chọn chỉ đổi màu nền.
              borderWidth: 2,
              borderColor: on ? colors.primary : colors.border,
              backgroundColor: on ? colors.primary : pressed ? colors.divider : colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space.sm,
              paddingVertical: space.sm,
            })}
          >
            <Txt variant="bodyStrong" tone={on ? 'onColor' : 'ink'} center>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Ô nhập có nhãn ở trên (không dùng chữ gợi ý thay nhãn — người lớn tuổi dễ tưởng đã điền sẵn). */
export function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  testID,
  placeholder,
  error,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: KeyboardTypeOptions;
  testID?: string;
  placeholder?: string;
  error?: string | null;
  maxLength?: number;
}) {
  // iOS: bàn phím số không có nút đóng → thêm thanh "Xong" phía trên bàn phím. Android: phím ✓ của bàn phím.
  const accessoryId = `field-${useId()}`;
  const ios = Platform.OS === 'ios';
  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="bodyStrong">{label}</Txt>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        returnKeyType="done"
        inputAccessoryViewID={ios ? accessoryId : undefined}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.toggleOff}
        maxLength={maxLength}
        style={{
          minHeight: 60,
          borderRadius: radius.md,
          borderWidth: 2,
          borderColor: error ? colors.danger : colors.ink,
          backgroundColor: colors.surface,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: font.size.button,
          fontFamily: font.family.medium,
          color: colors.ink,
        }}
      />
      {error ? <Txt tone="danger">{error}</Txt> : null}
      {ios ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: colors.divider, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Pressable
              testID="keyboard-done"
              accessibilityRole="button"
              accessibilityLabel={vi.common.done}
              onPress={() => Keyboard.dismiss()}
              style={{ minHeight: touch.min, minWidth: 96, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' }}
            >
              <Txt variant="bodyStrong" tone="primary">
                {vi.common.done}
              </Txt>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}

/** Biểu đồ cột đơn giản (không thêm thư viện): mỗi cột có nhãn ngày bên dưới, cột cao nhất ghi số. */
export function BarChart({ bars, format }: { bars: { label: string; amount: number }[]; format: (n: number) => string }) {
  const max = Math.max(...bars.map((b) => b.amount), 1);
  const peak = bars.reduce((i, b, k) => (b.amount > (bars[i]?.amount ?? 0) ? k : i), 0);
  const showEvery = bars.length > 8 ? 2 : 1;
  return (
    <View accessibilityRole="image" accessibilityLabel={bars.map((b) => `${b.label}: ${format(b.amount)}`).join(', ')} style={{ gap: space.xs }}>
      <Txt variant="small" tone="secondary">
        {`Cao nhất: ${format(bars[peak]?.amount ?? 0)}`}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 4 }}>
        {bars.map((b, i) => (
          <View key={`${b.label}-${i}`} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
            <View
              style={{
                height: `${Math.max((b.amount / max) * 100, b.amount > 0 ? 3 : 1)}%`,
                backgroundColor: i === peak && b.amount > 0 ? colors.primary : b.amount > 0 ? colors.primaryMuted : colors.divider,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {bars.map((b, i) => (
          <Txt key={`l-${i}`} variant="caption" tone="secondary" center numberOfLines={1} style={{ flex: 1 }} maxFontSizeMultiplier={1.2}>
            {i % showEvery === 0 ? b.label : ''}
          </Txt>
        ))}
      </View>
    </View>
  );
}
