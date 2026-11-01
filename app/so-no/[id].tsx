import { useRef, useState } from 'react';
import { Share, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ChoiceGrid, Field } from '../../src/components/Choice';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useDebtEntries, useDebtors, useRecordDebt, useVoidDebtEntry } from '../../src/features/books/hooks';
import { capitalize, formatVND, readVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { formatDateVN } from '../../src/lib/time';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

type Kind = 'DEBT' | 'PAYMENT';
const digitsOnly = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);

/** 3.7 Một khách nợ: số đang nợ, ghi lấy nợ / trả tiền, lịch sử, nhắn nhắc nợ. */
export default function KhachNo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = useBusinessId();
  const shop = useSession((s) => s.business?.business_name ?? '');
  const role = useSession((s) => s.role);
  const debtors = useDebtors(businessId);
  const entries = useDebtEntries(id);
  const record = useRecordDebt(businessId, id);
  const voidMut = useVoidDebtEntry(businessId, id);
  const [kind, setKind] = useState<Kind>('DEBT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const entryId = useRef(newId());

  const me = (debtors.data ?? []).find((d) => d.customer_id === id);
  const balance = me?.balance ?? 0;
  const value = Number(amount || '0');

  const save = () => {
    if (value <= 0) return setProblem(vi.expenses.enterAmount);
    setProblem(null);
    record.mutate(
      { entryId: entryId.current, kind, amount: value, note: note.trim() || undefined },
      {
        onSuccess: () => {
          entryId.current = newId();
          setAmount('');
          setNote('');
        },
      },
    );
  };

  const remind = () => {
    if (!me) return;
    void Share.share({ message: vi.debts.remindText(shop, me.name, formatVND(balance)) });
  };

  return (
    <Screen back={{ label: vi.debts.title, href: '/so-no' }} maxWidth={640}>
      {debtors.isLoading ? <Loading /> : null}
      {debtors.error ? <ErrorView error={debtors.error} onRetry={() => void debtors.refetch()} /> : null}
      {me ? (
        <>
          <Txt variant="heading">{me.name}</Txt>
          {me.phone ? <Txt tone="secondary">{me.phone}</Txt> : null}
          <Card style={{ alignItems: 'center' }}>
            <Txt variant="bodyStrong" tone="secondary">
              {balance > 0 ? vi.debts.owingLabel : vi.debts.clear}
            </Txt>
            <Amount value={formatVND(balance)} size={font.size.amount} tone={balance > 0 ? 'warn' : 'ink'} />
          </Card>
          {balance > 0 ? <Button kind="secondary" label={vi.debts.remind} onPress={remind} /> : null}

          <Card style={{ gap: space.md }}>
            <ChoiceGrid
              options={[
                { key: 'DEBT' as Kind, label: vi.debts.addDebt },
                { key: 'PAYMENT' as Kind, label: vi.debts.addPayment },
              ]}
              value={kind}
              onChange={(k) => {
                setKind(k);
                setProblem(null);
              }}
              testIdPrefix="debt-kind"
            />
            <Field label={vi.debts.amount} value={amount} onChangeText={(v) => setAmount(digitsOnly(v))} keyboardType="number-pad" testID="debt-amount" />
            {value > 0 ? <Txt tone="secondary">{`${formatVND(value)} — ${capitalize(readVND(value))}`}</Txt> : null}
            {kind === 'PAYMENT' && balance > 0 ? (
              <Button kind="link" label={`${vi.debts.payAll} (${formatVND(balance)})`} onPress={() => setAmount(String(balance))} />
            ) : null}
            {kind === 'DEBT' ? <Field label={vi.debts.note} value={note} onChangeText={setNote} maxLength={200} testID="debt-note" /> : null}
            {problem ? <Txt tone="danger" variant="bodyStrong">{problem}</Txt> : null}
            {record.error ? <ErrorView error={record.error} /> : null}
            <Button big label={kind === 'DEBT' ? vi.debts.saveDebt : vi.debts.savePayment} onPress={save} busy={record.isPending} />
          </Card>

          <Txt variant="title">{vi.debts.history}</Txt>
          {entries.isLoading ? <Loading /> : null}
          {(entries.data ?? []).map((e) => (
            <Card key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" tone={e.voided_at ? 'secondary' : e.kind === 'DEBT' ? 'warn' : 'success'}>
                  {`${e.kind === 'DEBT' ? vi.debts.entryDebt : vi.debts.entryPayment} ${formatVND(e.amount)}`}
                </Txt>
                <Txt variant="small" tone="secondary">
                  {[formatDateVN(e.created_at), e.note, e.voided_at ? vi.debts.voided : null].filter(Boolean).join(' · ')}
                </Txt>
              </View>
              {!e.voided_at && canManage(role) ? <Button kind="link" label={vi.debts.voidBtn} onPress={() => setVoidId(e.id)} /> : null}
            </Card>
          ))}
          {voidMut.error ? <ErrorView error={voidMut.error} /> : null}
        </>
      ) : null}
      <ConfirmSheet
        visible={voidId !== null}
        title={vi.debts.voidAsk}
        body={vi.debts.voidBody}
        yes={vi.debts.voidYes}
        no={vi.debts.voidNo}
        danger
        busy={voidMut.isPending}
        onYes={() => voidId && voidMut.mutate(voidId, { onSettled: () => setVoidId(null) })}
        onNo={() => setVoidId(null)}
      />
    </Screen>
  );
}
