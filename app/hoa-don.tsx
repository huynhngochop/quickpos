import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid, Field } from '../src/components/Choice';
import { Empty, ErrorView } from '../src/components/States';
import { canManage, useBusinessId, useSession } from '../src/features/session/store';
import { recentInvoices, updateInvoiceSettings } from '../src/features/shop/api';
import { formatVND } from '../src/lib/money';
import { formatDateVN } from '../src/lib/time';
import { space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';
import type { EinvoiceProvider } from '../src/types/api';

const PROVIDERS: EinvoiceProvider[] = ['NONE', 'DEMO', 'MISA', 'VIETTEL', 'VNPT', 'OTHER'];

/**
 * 7.4 Hóa đơn điện tử: chọn nhà cung cấp hộ đã đăng ký, mẫu số, ký hiệu; danh sách hóa đơn đã xuất.
 * Xuất hóa đơn cho từng đơn ở màn chi tiết đơn (Sổ → bấm vào đơn).
 */
export default function HoaDon() {
  const businessId = useBusinessId();
  const business = useSession((s) => s.business);
  const role = useSession((s) => s.role);
  const [provider, setProvider] = useState<EinvoiceProvider>(business?.einvoice_provider ?? 'NONE');
  const [form, setForm] = useState<'1' | '2'>(business?.invoice_form_no ?? '2');
  const [symbol, setSymbol] = useState(business?.invoice_symbol ?? '');
  const [saved, setSaved] = useState(false);
  const list = useQuery({ queryKey: ['invoices', businessId], queryFn: () => recentInvoices(businessId) });
  const save = useMutation({
    mutationFn: () => updateInvoiceSettings(businessId, provider, form, symbol.trim().toUpperCase()),
    onSuccess: (b) => {
      useSession.getState().set({ business: b });
      setSaved(true);
    },
  });

  return (
    <Screen back={{ label: vi.common.back }} maxWidth={720}>
      <Txt variant="heading">{vi.einvoice.title}</Txt>
      <Card tone="info" style={{ gap: space.xs }}>
        <Txt tone="primary">{vi.einvoice.rule}</Txt>
      </Card>

      {canManage(role) ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="title">{vi.einvoice.provider}</Txt>
          <ChoiceGrid
            options={PROVIDERS.map((p) => ({ key: p, label: vi.einvoice.providers[p] ?? p }))}
            value={provider}
            onChange={(p) => {
              setProvider(p);
              setSaved(false);
            }}
            testIdPrefix="provider"
          />
          {provider !== 'NONE' && provider !== 'DEMO' ? <Txt tone="warn">{vi.einvoice.needConnect}</Txt> : null}
          {provider !== 'NONE' ? (
            <>
              <Txt variant="title">{vi.einvoice.form}</Txt>
              <ChoiceGrid
                options={[
                  { key: '2' as const, label: vi.einvoice.form2 },
                  { key: '1' as const, label: vi.einvoice.form1 },
                ]}
                value={form}
                onChange={(f) => {
                  setForm(f);
                  setSaved(false);
                }}
                columns={1}
              />
              <Field label={vi.einvoice.symbol} value={symbol} onChangeText={(v) => setSymbol(v.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase())} maxLength={6} testID="invoice-symbol" placeholder="C26MAA" />
              <Txt variant="small" tone="secondary">
                {vi.einvoice.symbolHint}
              </Txt>
            </>
          ) : null}
          {save.error ? <ErrorView error={save.error} /> : null}
          {saved ? <Txt tone="success" variant="bodyStrong">{`✓ ${vi.einvoice.saved}`}</Txt> : null}
          <Button big label={vi.einvoice.save} onPress={() => save.mutate()} busy={save.isPending} disabled={provider !== 'NONE' && symbol.length !== 6} disabledLabel={vi.einvoice.enterSymbol} />
        </Card>
      ) : null}

      <Txt variant="title">{vi.einvoice.recent}</Txt>
      {list.error ? <ErrorView error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <Empty text={vi.einvoice.empty} /> : null}
      {(list.data ?? []).map((i) => (
        <Pressable key={i.id} accessibilityRole="button" onPress={() => i.order_id && router.push({ pathname: '/don/[id]', params: { id: i.order_id } })}>
          <Card style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{i.invoice_no ? `${i.symbol} · ${String(i.invoice_no).padStart(8, '0')}` : vi.einvoice.draft}</Txt>
              <Txt variant="small" tone="secondary">
                {[i.issued_at ? formatDateVN(i.issued_at) : null, i.buyer_name].filter(Boolean).join(' · ')}
              </Txt>
            </View>
            <Txt variant="bodyStrong">{formatVND(i.total_amount)}</Txt>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
