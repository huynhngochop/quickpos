import { useRef, useState } from 'react';
import { Share, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { ErrorView, Loading } from '../../src/components/States';
import { useBusinessId, useSession } from '../../src/features/session/store';
import { useCustomers } from '../../src/features/shop/hooks';
import { loyaltyEvents, redeemPoints } from '../../src/features/shop/api';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { formatDateVN } from '../../src/lib/time';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

/** 7.2 Một khách quen: điểm, số lần ghé, đổi điểm lấy quà, nhắn tin (Zalo/SMS qua nút chia sẻ). */
export default function KhachQuenChiTiet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = useBusinessId();
  const shop = useSession((s) => s.business?.business_name ?? '');
  const rate = useSession((s) => s.business?.loyalty_vnd_per_point ?? 10000);
  const customers = useCustomers(businessId);
  const events = useQuery({ queryKey: ['loyalty', id], queryFn: () => loyaltyEvents(id) });
  const qc = useQueryClient();
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const eventId = useRef(newId());
  const c = (customers.data ?? []).find((x) => x.id === id);

  const redeem = useMutation({
    mutationFn: () => redeemPoints(eventId.current, id, Number(points || '0'), note.trim() || undefined),
    onSuccess: () => {
      eventId.current = newId();
      setPoints('');
      setNote('');
      setMsg(vi.loyalty.redeemed);
      void qc.invalidateQueries({ queryKey: ['customers', businessId] });
      void qc.invalidateQueries({ queryKey: ['loyalty', id] });
    },
  });

  return (
    <Screen back={{ label: vi.loyalty.title, href: '/khach-quen' }} maxWidth={640}>
      {customers.isLoading ? <Loading /> : null}
      {c ? (
        <>
          <Txt variant="heading">{c.display_name}</Txt>
          {c.phone_number ? <Txt tone="secondary">{c.phone_number}</Txt> : null}
          <Card style={{ alignItems: 'center' }}>
            <Txt variant="bodyStrong" tone="secondary">
              {vi.loyalty.pointsNow}
            </Txt>
            <Amount value={vi.loyalty.points(c.points)} size={font.size.amountSmall} tone="ink" />
            <Txt tone="secondary">{`${vi.loyalty.visits(c.visits)} · ${vi.loyalty.spent(formatVND(c.total_spent))}`}</Txt>
            <Txt variant="small" tone="secondary">
              {vi.loyalty.rule(formatVND(rate))}
            </Txt>
          </Card>
          <Button
            kind="secondary"
            label={vi.loyalty.message}
            onPress={() => void Share.share({ message: vi.loyalty.messageText(shop, c.display_name, c.points) })}
          />

          <Card style={{ gap: space.md }}>
            <Txt variant="title">{vi.loyalty.redeem}</Txt>
            <Field label={vi.loyalty.redeemPoints} value={points} onChangeText={(v) => setPoints(v.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" testID="redeem-points" />
            <Field label={vi.loyalty.redeemNote} value={note} onChangeText={setNote} maxLength={200} />
            {msg ? <Txt tone="success" variant="bodyStrong">{`✓ ${msg}`}</Txt> : null}
            {redeem.error ? <ErrorView error={redeem.error} /> : null}
            <Button label={vi.loyalty.redeemSave} onPress={() => (Number(points) > 0 ? redeem.mutate() : setMsg(null))} busy={redeem.isPending} disabled={!(Number(points) > 0)} />
          </Card>

          <Txt variant="title">{vi.debts.history}</Txt>
          {(events.data ?? []).map((e) => (
            <View key={e.id} style={{ flexDirection: 'row', gap: space.md }}>
              <Txt style={{ flex: 1 }}>{`${formatDateVN(e.created_at)} · ${e.note ?? ''}`}</Txt>
              <Txt variant="bodyStrong" tone={e.kind === 'EARN' ? 'success' : 'warn'}>
                {`${e.kind === 'EARN' ? '+' : '−'}${e.points}`}
              </Txt>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
