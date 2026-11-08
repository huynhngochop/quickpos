import { View } from 'react-native';
import { Button } from '../../../components/Button';
import { addMonthsDay, dayToVN } from '../inventory';
import { vnDay } from '../../../lib/time';
import { space } from '../../../theme/tokens';
import { vi } from '../../../i18n/vi';

/** Bấm nhanh hạn dùng tính từ hôm nay (+3 / +6 / +12 tháng) → điền ô ngày/tháng/năm */
export function ExpiryQuick({ onPick }: { onPick: (ddmmyyyy: string) => void }) {
  const today = vnDay();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {[3, 6, 12].map((m) => (
        <Button
          key={m}
          kind="secondary"
          label={vi.inv.plusMonths(m)}
          onPress={() => onPick(dayToVN(addMonthsDay(today, m)))}
          style={{ flex: 1, minHeight: 56 }}
          testID={`expiry-plus-${m}`}
        />
      ))}
    </View>
  );
}
