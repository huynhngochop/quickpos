import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Empty, ErrorView, Loading } from '../../src/components/States';
import { useBusinessId } from '../../src/features/session/store';
import { useAssign, useCandidates, useEvent, useOrderByCode } from '../../src/features/review/hooks';
import { formatVND } from '../../src/lib/money';
import { formatTimeVN } from '../../src/lib/time';
import { colors, font, radius } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';
import type { Order } from '../../src/types/api';

/** 3.3 Gán khoản tiền chưa rõ đơn vào một đơn chưa trả. */
export default function GanDon() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const businessId = useBusinessId();
  const ev = useEvent(eventId ?? '');
  const candidates = useCandidates(businessId, ev.data?.amount);
  const [code, setCode] = useState('');
  const byCode = useOrderByCode(businessId, code);
  const [picked, setPicked] = useState<Order | null>(null);
  const assign = useAssign(businessId);

  if (ev.isLoading) return <Screen back={{ label: vi.common.back }}><Loading /></Screen>;
  if (ev.error || !ev.data) return <Screen back={{ label: vi.common.back }}><ErrorView error={ev.error} onRetry={() => void ev.refetch()} /></Screen>;

  const found = byCode.data?.payment_status === 'UNPAID' ? byCode.data : null;
  const list = [...(found ? [found] : []), ...(candidates.data ?? []).filter((o) => o.id !== found?.id)];

  return (
    <Screen
      back={{ label: vi.common.back }}
      footer={
        <>
          {assign.error ? <ErrorView error={assign.error} /> : null}
          <Button
            big
            label={picked ? vi.review.assignTo(picked.order_code) : vi.review.pickOrder}
            disabled={!picked}
            disabledLabel={vi.review.pickOrder}
            busy={assign.isPending}
            onPress={() => picked && assign.mutate({ eventId: ev.data!.id, orderId: picked.id }, { onSuccess: () => router.back() })}
          />
        </>
      }
    >
      <Txt variant="heading">{vi.review.assignTitle(formatVND(ev.data.amount), formatTimeVN(ev.data.received_at))}</Txt>
      <Txt variant="bodyStrong">{vi.review.codeSearch}</Txt>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="K7MP3QXA"
        placeholderTextColor={colors.secondary}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        accessibilityLabel={vi.review.codeSearch}
        testID="code-search"
        style={{
          height: 60,
          borderWidth: 2,
          borderColor: colors.ink,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          paddingHorizontal: 14,
          fontSize: font.size.button,
          fontFamily: font.family.bold,
          color: colors.ink,
          letterSpacing: 2,
        }}
      />
      <Txt variant="bodyStrong" tone="secondary">
        {vi.review.sameAmount}
      </Txt>
      {candidates.isLoading ? <Loading /> : null}
      {candidates.error ? <ErrorView error={candidates.error} onRetry={() => void candidates.refetch()} /> : null}
      {!candidates.isLoading && list.length === 0 ? <Empty text={vi.review.noCandidate} /> : null}
      {list.map((o) => {
        const on = picked?.id === o.id;
        return (
          <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setPicked(o)}>
            <Card style={{ borderWidth: on ? 3 : 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : colors.surface }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="title">{formatVND(o.total_amount)}</Txt>
                <Txt tone="secondary">{formatTimeVN(o.sold_at)}</Txt>
              </View>
              <Txt tone="secondary">{vi.review.orderLabel(o.order_code)}</Txt>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
