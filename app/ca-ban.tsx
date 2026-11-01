import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { Field } from '../src/components/Choice';
import { ErrorView, Loading } from '../src/components/States';
import { useBusinessId } from '../src/features/session/store';
import { useCurrentShift } from '../src/features/shop/hooks';
import { closeShift, openShift, recentShifts } from '../src/features/shop/api';
import { capitalize, formatVND, readVND } from '../src/lib/money';
import { newId } from '../src/lib/device';
import { formatDateVN, formatTimeVN } from '../src/lib/time';
import { font, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

const money = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);

/** 7.3 Ca bán và két tiền mặt: mở ca (tiền đầu ca), xem tiền phải có, đóng ca (đếm thực tế → thừa/thiếu). */
export default function CaBan() {
  const businessId = useBusinessId();
  const qc = useQueryClient();
  const shift = useCurrentShift(businessId);
  const history = useQuery({ queryKey: ['shifts', businessId], queryFn: () => recentShifts(businessId) });
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<null | { expected: number; counted: number }>(null);
  const shiftId = useRef(newId());

  const done = () => {
    setCash('');
    setNote('');
    void qc.invalidateQueries({ queryKey: ['shift', businessId] });
    void qc.invalidateQueries({ queryKey: ['shifts', businessId] });
  };
  const open = useMutation({
    mutationFn: () => openShift(shiftId.current, businessId, Number(cash || '0')),
    onSuccess: () => {
      shiftId.current = newId();
      setResult(null);
      done();
    },
  });
  const close = useMutation({
    mutationFn: () => closeShift(shift.data!.shift_id, Number(cash || '0'), note.trim() || undefined),
    onSuccess: (s) => {
      setResult({ expected: s.expected_cash ?? 0, counted: s.counted_cash ?? 0 });
      done();
    },
  });

  const s = shift.data;
  const diff = result ? result.counted - result.expected : 0;

  return (
    <Screen back={{ label: vi.common.back }} maxWidth={640}>
      <Txt variant="heading">{vi.shift.title}</Txt>
      <Txt tone="secondary">{vi.shift.subtitle}</Txt>
      {shift.isLoading ? <Loading /> : null}
      {shift.error ? <ErrorView error={shift.error} onRetry={() => void shift.refetch()} /> : null}

      {result ? (
        <Card tone={diff === 0 ? 'success' : 'warn'} style={{ gap: space.xs }}>
          <Txt variant="title" tone={diff === 0 ? 'success' : 'warn'}>
            {diff === 0 ? vi.shift.exact : diff > 0 ? vi.shift.over(formatVND(diff)) : vi.shift.short(formatVND(-diff))}
          </Txt>
          <Txt>{`${vi.shift.expected}: ${formatVND(result.expected)} · ${vi.shift.counted}: ${formatVND(result.counted)}`}</Txt>
        </Card>
      ) : null}

      {s ? (
        <>
          <Card style={{ gap: space.xs }}>
            <Txt variant="bodyStrong" tone="success">
              {vi.shift.openSince(formatTimeVN(s.opened_at), formatDateVN(s.opened_at))}
            </Txt>
            <Row label={vi.shift.opening} value={formatVND(s.opening_cash)} />
            <Row label={vi.shift.cashSales(s.cash_orders)} value={`+ ${formatVND(s.cash_sales)}`} />
            <Row label={vi.shift.cashExpenses} value={`− ${formatVND(s.cash_expenses)}`} />
            <View style={{ alignItems: 'center', marginTop: space.sm }}>
              <Txt variant="bodyStrong" tone="secondary">
                {vi.shift.shouldHave}
              </Txt>
              <Amount value={formatVND(s.expected_cash)} size={font.size.amountSmall} />
            </View>
          </Card>
          <Card style={{ gap: space.md }}>
            <Txt variant="title">{vi.shift.close}</Txt>
            <Field label={vi.shift.countedLabel} value={cash} onChangeText={(v) => setCash(money(v))} keyboardType="number-pad" testID="shift-cash" />
            {cash ? <Txt tone="secondary">{capitalize(readVND(Number(cash)))}</Txt> : null}
            <Field label={vi.shift.note} value={note} onChangeText={setNote} maxLength={200} />
            {close.error ? <ErrorView error={close.error} /> : null}
            <Button big label={vi.shift.closeBtn} onPress={() => close.mutate()} busy={close.isPending} disabled={!cash} disabledLabel={vi.shift.countFirst} />
          </Card>
        </>
      ) : shift.isSuccess ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="title">{vi.shift.open}</Txt>
          <Field label={vi.shift.openingLabel} value={cash} onChangeText={(v) => setCash(money(v))} keyboardType="number-pad" testID="shift-cash" />
          {cash ? <Txt tone="secondary">{capitalize(readVND(Number(cash)))}</Txt> : null}
          {open.error ? <ErrorView error={open.error} /> : null}
          <Button big label={vi.shift.openBtn} onPress={() => open.mutate()} busy={open.isPending} />
        </Card>
      ) : null}

      <Txt variant="title">{vi.shift.history}</Txt>
      {(history.data ?? []).filter((h) => h.closed_at).map((h) => {
        const d = (h.counted_cash ?? 0) - (h.expected_cash ?? 0);
        return (
          <Card key={h.id} style={{ gap: 2 }}>
            <Txt variant="bodyStrong">{`${formatDateVN(h.opened_at)} ${formatTimeVN(h.opened_at)} – ${formatTimeVN(h.closed_at!)}`}</Txt>
            <Txt tone={d === 0 ? 'success' : 'warn'}>
              {`${vi.shift.counted} ${formatVND(h.counted_cash ?? 0)} · ${d === 0 ? vi.shift.exact : d > 0 ? vi.shift.over(formatVND(d)) : vi.shift.short(formatVND(-d))}`}
            </Txt>
          </Card>
        );
      })}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      <Txt style={{ flex: 1 }}>{label}</Txt>
      <Txt variant="bodyStrong">{value}</Txt>
    </View>
  );
}
