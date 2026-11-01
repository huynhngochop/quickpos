import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { callSupport } from '../src/components/States';
import { openOwnerScreen } from '../src/features/session/hooks';
import { useBusinessId } from '../src/features/session/store';
import { useCurrentShift } from '../src/features/shop/hooks';
import { formatTimeVN } from '../src/lib/time';
import { space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 7.0 Việc khác: các việc ít dùng hơn, mỗi dòng một việc có chữ giải thích. */
export default function ViecKhac() {
  const businessId = useBusinessId();
  const shift = useCurrentShift(businessId);
  const items: { label: string; sub: string; go: () => void }[] = [
    { label: vi.more.loyalty, sub: vi.more.loyaltySub, go: () => router.push('/khach-quen') },
    {
      label: vi.more.shift,
      sub: shift.data ? vi.more.shiftOpen(formatTimeVN(shift.data.opened_at)) : vi.more.shiftSub,
      go: () => router.push('/ca-ban'),
    },
    { label: vi.more.tax, sub: vi.more.taxSub, go: () => openOwnerScreen('/thue') },
    { label: vi.more.einvoice, sub: vi.more.einvoiceSub, go: () => openOwnerScreen('/hoa-don') },
    { label: vi.more.staff, sub: vi.more.staffSub, go: () => openOwnerScreen('/nhan-vien') },
    { label: vi.more.settings, sub: vi.more.settingsSub, go: () => openOwnerScreen('/cai-dat') },
    { label: vi.more.support, sub: vi.more.supportSub, go: callSupport },
  ];
  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={640}>
      <Txt variant="heading">{vi.main.more}</Txt>
      {items.map((it) => (
        <Pressable key={it.label} accessibilityRole="button" accessibilityLabel={`${it.label}, ${it.sub}`} onPress={it.go}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt variant="title">{it.label}</Txt>
              <Txt tone="secondary">{it.sub}</Txt>
            </View>
            <Txt variant="heading" tone="secondary">
              ›
            </Txt>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
