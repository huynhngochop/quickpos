import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Txt } from '../../../components/Txt';
import { Button } from '../../../components/Button';
import { ChoiceGrid, Field } from '../../../components/Choice';
import { ErrorView } from '../../../components/States';
import { setLocalPaymentAccount } from '../api';
import { BANK_LIST } from '../../../lib/banks';
import { fold } from '../../shop/inventory';
import { space } from '../../../theme/tokens';
import { vi } from '../../../i18n/vi';
import type { PaymentAccount } from '../../../types/api';

/** 8 ngân hàng nhiều hộ dùng nhất hiện sẵn; ngân hàng khác thì gõ tìm. */
const TOP = 8;

/**
 * Chế độ lưu trên máy: chủ quán tự chọn ngân hàng, gõ số tài khoản và tên chủ tài khoản để in lên mã QR.
 * (Bản có máy chủ lấy tài khoản qua cổng thanh toán, không cho gõ — CLAUDE.md.)
 */
export function LocalAccountForm({
  businessId,
  current,
  onSaved,
}: {
  businessId: string;
  current?: PaymentAccount | null;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [bin, setBin] = useState(current?.bank_bin ?? '');
  const [query, setQuery] = useState('');
  const [accountNo, setAccountNo] = useState(current?.account_no ?? '');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const banks = useMemo(() => {
    const q = fold(query);
    const list = q ? BANK_LIST.filter((b) => fold(b.name).includes(q)) : BANK_LIST.slice(0, TOP);
    // Ngân hàng đang chọn luôn hiện trong lưới
    const sel = BANK_LIST.find((b) => b.bin === bin);
    return sel && !list.some((b) => b.bin === bin) ? [sel, ...list] : list;
  }, [query, bin]);

  const save = useMutation({
    mutationFn: () =>
      setLocalPaymentAccount({
        businessId,
        bankBin: bin,
        accountNo: accountNo.replace(/\s+/g, ''),
        accountName: fold(name).toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account', businessId] });
      onSaved();
    },
  });

  const submit = () => {
    if (!bin) return setProblem(vi.local.enterBank);
    if (!/^[0-9]{4,19}$/.test(accountNo.replace(/\s+/g, ''))) return setProblem(vi.local.enterAccountNo);
    if (fold(name).replace(/[^a-z]/g, '').length < 2) return setProblem(vi.local.enterAccountName);
    setProblem(null);
    save.mutate();
  };

  return (
    <View style={{ gap: space.md }}>
      <Txt variant="bodyStrong">{vi.local.bank}</Txt>
      <Field label={vi.local.bankSearch} value={query} onChangeText={setQuery} maxLength={30} testID="bank-search" />
      <ChoiceGrid options={banks.map((b) => ({ key: b.bin, label: b.name }))} value={bin} onChange={setBin} columns={2} testIdPrefix="bank" />
      <Field
        label={vi.local.accountNo}
        value={accountNo}
        onChangeText={(v) => setAccountNo(v.replace(/[^0-9]/g, '').slice(0, 19))}
        keyboardType="number-pad"
        testID="account-no"
      />
      <Field label={vi.local.accountName} value={name} onChangeText={(v) => setName(v.slice(0, 50))} testID="account-name" />
      {problem ? (
        <Txt tone="danger" variant="bodyStrong">
          {problem}
        </Txt>
      ) : null}
      {save.error ? <ErrorView error={save.error} /> : null}
      <Button big label={vi.local.accountSave} onPress={submit} busy={save.isPending} />
    </View>
  );
}
