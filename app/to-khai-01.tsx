import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid, Field } from '../src/components/Choice';
import { Checkbox, ErrorView, Loading } from '../src/components/States';
import { useBusinessId, useSession } from '../src/features/session/store';
import { revenueNotice } from '../src/features/shop/api';
import { FORM01_LIMIT, GROUP_CODE, GROUP_NAME, form01Range, type Form01Data, type Form01Period } from '../src/features/tax/form01';
import { shareForm01Pdf, shareForm01Xlsx } from '../src/features/tax/form01Share';
import { formatVND } from '../src/lib/money';
import { vnDay } from '../src/lib/time';
import { font, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';
import type { TaxGroup } from '../src/types/api';

/**
 * 5.2 Thông báo doanh thu / tờ khai thuế năm, mẫu 01/TKN-CNKD (TT 89/2026/TT-BTC): chọn kỳ, kiểm tra người nộp thuế,
 * xem doanh thu theo nhóm ngành, tải PDF để in nộp hoặc Excel để sửa. Số liệu tham khảo.
 */
export default function ToKhai01() {
  const businessId = useBusinessId();
  const business = useSession((s) => s.business);
  const today = vnDay();
  const thisYear = Number(today.slice(0, 4));
  // Đầu năm thường khai cho năm trước
  const [year, setYear] = useState(today.slice(5, 7) <= '03' ? thisYear - 1 : thisYear);
  const [period, setPeriod] = useState<Form01Period>('YEAR');
  const [first, setFirst] = useState(true);
  const [suppNo, setSuppNo] = useState('1');
  const [taxpayer, setTaxpayer] = useState(business?.owner_name ?? '');
  const [taxCode, setTaxCode] = useState(business?.tax_code ?? '');
  const [address, setAddress] = useState(business?.address ?? '');
  const [phone, setPhone] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const range = form01Range(period, year);
  const to = range.to > today ? today : range.to;
  const q = useQuery({
    queryKey: ['revenue-notice', businessId, range.from, to],
    queryFn: () => revenueNotice(businessId, range.from, to),
    enabled: !!businessId && range.from <= today,
  });

  const data = (): Form01Data | null => {
    if (!q.data) return null;
    if (!taxpayer.trim() || !/^[0-9]{10}([0-9]{2}|-[0-9]{3})?$/.test(taxCode.trim())) {
      setProblem(vi.inv.form01Enter);
      return null;
    }
    setProblem(null);
    return {
      period, year, first, supplementNo: first ? null : Number(suppNo || '1'), taxpayer: taxpayer.trim(), taxCode: taxCode.trim(),
      address: address.trim(), phone: phone.trim(), byGroup: q.data.by_group, total: q.data.total, signDay: today,
    };
  };
  const make = useMutation({
    mutationFn: async (kind: 'PDF' | 'XLSX') => {
      const d = data();
      if (!d) return;
      if (kind === 'PDF') await shareForm01Pdf(d, vi.inv.form01Title);
      else await shareForm01Xlsx(d, vi.inv.form01Title);
    },
  });

  const over = (q.data?.total ?? 0) > FORM01_LIMIT;
  const groups = (Object.keys(GROUP_CODE) as TaxGroup[]).filter((g) => (q.data?.by_group[g] ?? 0) > 0);

  return (
    <Screen back={{ label: vi.tax.title, href: '/thue' }} maxWidth={720}>
      <Txt variant="heading">{vi.inv.form01Title}</Txt>
      <Card tone="info">
        <Txt tone="primary">{vi.inv.form01Help}</Txt>
      </Card>

      <Txt variant="bodyStrong">{vi.inv.form01Year}</Txt>
      <ChoiceGrid
        options={[thisYear - 2, thisYear - 1, thisYear].map((y) => ({ key: String(y), label: String(y) }))}
        value={String(year)}
        onChange={(k) => setYear(Number(k))}
        columns={3}
        testIdPrefix="form01-year"
      />
      <Txt variant="bodyStrong">{vi.inv.form01Period}</Txt>
      <ChoiceGrid
        options={(['YEAR', 'H1', 'H2'] as Form01Period[]).map((k) => ({ key: k, label: vi.inv.form01Periods[k] ?? k }))}
        value={period}
        onChange={setPeriod}
        columns={3}
        testIdPrefix="form01-period"
      />

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <Card style={{ gap: space.sm }}>
          <Txt variant="bodyStrong" tone="secondary">
            {vi.inv.form01Revenue}
          </Txt>
          <Amount value={formatVND(q.data.total)} size={font.size.amountSmall} />
          <Txt tone="secondary">{vi.inv.form01Orders(q.data.orders)}</Txt>
          {groups.map((g) => (
            <View key={g} style={{ flexDirection: 'row', gap: space.md }}>
              <Txt style={{ flex: 1 }}>{`${GROUP_CODE[g]}. ${GROUP_NAME[g]}`}</Txt>
              <Txt variant="bodyStrong">{formatVND(q.data!.by_group[g] ?? 0)}</Txt>
            </View>
          ))}
        </Card>
      ) : null}
      {over ? (
        <Card tone="warn">
          <Txt tone="warn" variant="bodyStrong">
            {vi.inv.form01Over}
          </Txt>
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <Field label={vi.inv.form01Taxpayer} value={taxpayer} onChangeText={setTaxpayer} maxLength={100} testID="form01-taxpayer" />
        <Field label={vi.inv.form01TaxCode} value={taxCode} onChangeText={(v) => setTaxCode(v.slice(0, 14))} keyboardType="number-pad" testID="form01-taxcode" />
        <Field label={vi.inv.form01Address} value={address} onChangeText={setAddress} maxLength={200} />
        <Field label={vi.inv.form01Phone} value={phone} onChangeText={(v) => setPhone(v.slice(0, 20))} keyboardType="phone-pad" />
        <Checkbox label={vi.inv.form01First} value={first} onChange={setFirst} />
        {!first ? (
          <Field label={vi.inv.form01SupplementNo} value={suppNo} onChangeText={(v) => setSuppNo(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
        ) : null}
      </Card>
      {problem ? (
        <Txt tone="danger" variant="bodyStrong">
          {problem}
        </Txt>
      ) : null}
      {make.error ? <ErrorView error={make.error} /> : null}
      <Button big label={vi.inv.form01Pdf} onPress={() => make.mutate('PDF')} busy={make.isPending} disabled={!q.data || over} testID="form01-pdf" />
      <Button kind="secondary" label={vi.inv.form01Excel} onPress={() => make.mutate('XLSX')} disabled={!q.data || over || make.isPending} testID="form01-xlsx" />
      <Txt variant="small" tone="secondary">
        {vi.inv.form01Note}
      </Txt>
    </Screen>
  );
}
