import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFlash } from '../features/sale/announce';
import { colors, font, space } from '../theme/tokens';
import { Amount, Txt } from './Txt';
import { capitalize, formatVND, readVND } from '../lib/money';
import { vi } from '../i18n/vi';

/** Cả màn hình xanh ≥ 3 giây khi tiền về — nằm trên mọi màn hình. Chạm để đóng sớm. */
export function PaidFlash() {
  const view = useFlash((s) => s.view);
  const hide = useFlash((s) => s.hide);
  const insets = useSafeAreaInsets();
  if (!view) return null;

  const partial = view.kind === 'PARTIAL';
  // Số hiện to = số tiền thật đã về (chuyển dư/thiếu thì khác tổng đơn)
  const amount = view.kind === 'PARTIAL' || view.kind === 'OVERPAID' ? view.received : view.total;
  const bg = partial ? colors.warn : colors.success;
  return (
    <Pressable
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${partial ? vi.paid.partialTitle : vi.paid.received} ${formatVND(amount)}`}
      onPress={hide}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bg, paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md }}>
        <Txt variant="heading" tone="onColor" center>
          {partial ? vi.paid.partialTitle : vi.paid.received}
        </Txt>
        <Amount value={formatVND(amount)} size={font.size.amount + 8} tone="onColor" />
        <Txt variant="title" tone="onColor" center>
          {capitalize(readVND(amount))}
        </Txt>
        {view.kind === 'PARTIAL' ? (
          <Txt variant="title" tone="onColor" center>
            {`${vi.paid.missing} ${formatVND(view.missing)}`}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}
