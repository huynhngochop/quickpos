import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid, Field } from '../src/components/Choice';
import { ConfirmSheet } from '../src/components/ConfirmSheet';
import { Empty, ErrorView, Loading } from '../src/components/States';
import { canManage, useBusinessId, useSession } from '../src/features/session/store';
import { useAddExpense, useExpenses, useVoidExpense } from '../src/features/books/hooks';
import { capitalize, formatVND, readVND } from '../src/lib/money';
import { newId } from '../src/lib/device';
import { monthStart, vnDay } from '../src/lib/time';
import { font, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

type Cat = (typeof vi.expenses.categories)[number];
const digitsOnly = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** 3.5 Chi tiêu: ghi khoản chi tay (nhập hàng, điện nước…) để báo cáo ra lãi. Thu ngân ghi được, chủ/quản lý hủy được. */
export default function ChiTieu() {
  const businessId = useBusinessId();
  const role = useSession((s) => s.role);
  const today = vnDay();
  const list = useExpenses(businessId, monthStart(today), today);
  const add = useAddExpense(businessId);
  const voidMut = useVoidExpense(businessId);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Cat | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  // Mã sinh một lần cho khoản chi đang nhập: bấm "Lưu" lại khi mạng chập chờn không ghi trùng
  const entryId = useRef(newId());

  const value = Number(amount || '0');
  const total = (list.data ?? []).reduce((s, e) => s + e.amount, 0);

  const save = () => {
    setSaved(false);
    if (value <= 0) return setProblem(vi.expenses.enterAmount);
    if (!category) return setProblem(vi.expenses.pickCategory);
    setProblem(null);
    add.mutate(
      { entryId: entryId.current, amount: value, category, note: note.trim() || undefined },
      {
        onSuccess: () => {
          entryId.current = newId();
          setAmount('');
          setNote('');
          setCategory(null);
          setSaved(true);
        },
      },
    );
  };

  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={640}>
      <Txt variant="heading">{vi.expenses.title}</Txt>
      <Txt tone="secondary">{vi.expenses.subtitle}</Txt>

      <Card style={{ alignItems: 'center' }}>
        <Txt variant="bodyStrong" tone="secondary">
          {vi.expenses.thisMonth}
        </Txt>
        <Amount value={formatVND(total)} size={font.size.amountSmall} />
      </Card>

      <Card style={{ gap: space.md }}>
        <Txt variant="title">{vi.expenses.add}</Txt>
        <Field label={vi.expenses.amount} value={amount} onChangeText={(v) => setAmount(digitsOnly(v))} keyboardType="number-pad" testID="expense-amount" />
        {value > 0 ? (
          <Txt tone="secondary">{`${formatVND(value)} — ${capitalize(readVND(value))}`}</Txt>
        ) : null}
        <Txt variant="bodyStrong">{vi.expenses.category}</Txt>
        <ChoiceGrid options={vi.expenses.categories.map((c) => ({ key: c, label: c }))} value={category} onChange={setCategory} testIdPrefix="cat" />
        <Field label={vi.expenses.note} value={note} onChangeText={setNote} maxLength={200} testID="expense-note" />
        {problem ? <Txt tone="danger" variant="bodyStrong">{problem}</Txt> : null}
        {add.error ? <ErrorView error={add.error} /> : null}
        {saved ? (
          <Txt tone="success" variant="bodyStrong">
            {`✓ ${vi.expenses.saved}`}
          </Txt>
        ) : null}
        <Button big label={vi.expenses.save} onPress={save} busy={add.isPending} />
      </Card>

      <Txt variant="title">{vi.expenses.list}</Txt>
      {list.isLoading ? <Loading /> : null}
      {list.error ? <ErrorView error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <Empty text={vi.expenses.empty} /> : null}
      {(list.data ?? []).map((e) => (
        <Card key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{`${formatVND(e.amount)} · ${e.category}`}</Txt>
            <Txt variant="small" tone="secondary">
              {e.description ? `${dm(e.entry_date)} · ${e.description}` : dm(e.entry_date)}
            </Txt>
          </View>
          {canManage(role) ? <Button kind="link" label={vi.expenses.voidBtn} onPress={() => setVoidId(e.source_id)} /> : null}
        </Card>
      ))}
      {voidMut.error ? <ErrorView error={voidMut.error} /> : null}
      <ConfirmSheet
        visible={voidId !== null}
        title={vi.expenses.voidAsk}
        body={vi.expenses.voidBody}
        yes={vi.expenses.voidYes}
        no={vi.expenses.voidNo}
        danger
        busy={voidMut.isPending}
        onYes={() => voidId && voidMut.mutate(voidId, { onSettled: () => setVoidId(null) })}
        onNo={() => setVoidId(null)}
      />
    </Screen>
  );
}
