import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../../src/components/Screen';
import { Amount, Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { Checkbox, Empty, ErrorView, Loading } from '../../src/components/States';
import { useBusinessId } from '../../src/features/session/store';
import { useAddDebtor, useDebtors } from '../../src/features/books/hooks';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { font, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

/** 3.6 Sổ nợ: danh sách khách đang nợ (nợ nhiều ở trên), thêm khách mới. */
export default function SoNo() {
  const businessId = useBusinessId();
  const debtors = useDebtors(businessId);
  const add = useAddDebtor(businessId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const customerId = useRef(newId());

  const rows = debtors.data ?? [];
  const owing = rows.filter((r) => r.balance > 0);
  const total = owing.reduce((s, r) => s + r.balance, 0);

  const save = () => {
    const p = phone.replace(/\D/g, '');
    if (!name.trim()) return setProblem(vi.debts.enterName);
    if (p && !consent) return setProblem(vi.debts.consentNeeded);
    setProblem(null);
    const id = customerId.current;
    add.mutate(
      { customerId: id, name: name.trim(), phone: p || undefined, phoneConsent: consent },
      {
        onSuccess: () => {
          customerId.current = newId();
          setAdding(false);
          setName('');
          setPhone('');
          setConsent(false);
          router.push({ pathname: '/so-no/[id]', params: { id } });
        },
      },
    );
  };

  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={640}>
      <Txt variant="heading">{vi.debts.title}</Txt>
      <Txt tone="secondary">{vi.debts.subtitle}</Txt>

      <Card style={{ alignItems: 'center' }}>
        <Txt variant="bodyStrong" tone="secondary">
          {vi.debts.total}
        </Txt>
        <Amount value={formatVND(total)} size={font.size.amountSmall} tone={total > 0 ? 'warn' : 'ink'} />
        <Txt tone="secondary">{vi.debts.customers(owing.length)}</Txt>
      </Card>

      {adding ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="title">{vi.debts.addCustomer}</Txt>
          <Field label={vi.debts.name} value={name} onChangeText={setName} maxLength={100} testID="debtor-name" />
          <Field label={vi.debts.phone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={13} testID="debtor-phone" />
          {phone.replace(/\D/g, '').length > 0 ? <Checkbox label={vi.debts.consent} value={consent} onChange={setConsent} /> : null}
          {problem ? <Txt tone="danger" variant="bodyStrong">{problem}</Txt> : null}
          {add.error ? <ErrorView error={add.error} /> : null}
          <Button big label={vi.debts.saveCustomer} onPress={save} busy={add.isPending} />
          <Button kind="link" label={vi.common.back} onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Button big label={vi.debts.addCustomer} onPress={() => setAdding(true)} />
      )}

      {debtors.isLoading ? <Loading /> : null}
      {debtors.error ? <ErrorView error={debtors.error} onRetry={() => void debtors.refetch()} /> : null}
      {debtors.data && rows.length === 0 ? <Empty text={vi.debts.empty} /> : null}
      {rows.map((r) => (
        <Pressable
          key={r.customer_id}
          accessibilityRole="button"
          accessibilityLabel={`${r.name}, ${r.balance > 0 ? vi.debts.owes(formatVND(r.balance)) : vi.debts.clear}`}
          onPress={() => router.push({ pathname: '/so-no/[id]', params: { id: r.customer_id } })}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{r.name}</Txt>
              <Txt tone={r.balance > 0 ? 'warn' : 'success'} variant="bodyStrong">
                {r.balance > 0 ? vi.debts.owes(formatVND(r.balance)) : vi.debts.clear}
              </Txt>
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
