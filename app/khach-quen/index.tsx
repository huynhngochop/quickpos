import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { Checkbox, Empty, ErrorView, Loading } from '../../src/components/States';
import { useBusinessId } from '../../src/features/session/store';
import { useCustomers } from '../../src/features/shop/hooks';
import { setOrderCustomer, upsertCustomer } from '../../src/features/shop/api';
import { useSale } from '../../src/features/sale/store';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';
import type { Customer } from '../../src/types/api';

/**
 * 7.1 Khách quen: danh sách (tìm theo tên/số), thêm khách, tích điểm.
 * pick=1: chọn khách cho đơn đang bán (màn Thu tiền); order=<mã đơn>: gắn khách vào đơn đã bán (cộng điểm).
 */
export default function KhachQuen() {
  const { pick, order } = useLocalSearchParams<{ pick?: string; order?: string }>();
  const businessId = useBusinessId();
  const customers = useCustomers(businessId);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const customerId = useRef(newId());

  const choose = useMutation({
    mutationFn: async (c: Customer) => {
      if (order) await setOrderCustomer(order, c.id);
      return c;
    },
    onSuccess: (c) => {
      if (order) {
        void qc.invalidateQueries({ queryKey: ['order', order] });
        void qc.invalidateQueries({ queryKey: ['customers', businessId] });
      } else {
        useSale.getState().setCustomer({ id: c.id, name: c.display_name, points: c.points });
      }
      router.back();
    },
  });

  const add = useMutation({
    mutationFn: () =>
      upsertCustomer({ customerId: customerId.current, businessId, name: name.trim(), phone: phone.replace(/\D/g, '') || undefined, consent }),
    onSuccess: (c) => {
      customerId.current = newId();
      setAdding(false);
      setName('');
      setPhone('');
      setConsent(false);
      void qc.invalidateQueries({ queryKey: ['customers', businessId] });
      if (pick) choose.mutate(c);
      else router.push({ pathname: '/khach-quen/[id]', params: { id: c.id } });
    },
  });

  const save = () => {
    if (!name.trim()) return setProblem(vi.debts.enterName);
    if (phone.replace(/\D/g, '') && !consent) return setProblem(vi.debts.consentNeeded);
    setProblem(null);
    add.mutate();
  };

  const q = search.trim().toLowerCase();
  const rows = (customers.data ?? []).filter(
    (c) => !q || c.display_name.toLowerCase().includes(q) || (c.phone_number ?? '').includes(q.replace(/\D/g, '') || '§'),
  );

  return (
    <Screen back={{ label: pick ? vi.common.back : vi.common.home, href: pick ? undefined : '/trang-chinh' }} maxWidth={640}>
      <Txt variant="heading">{pick ? vi.loyalty.pickTitle : vi.loyalty.title}</Txt>
      <Txt tone="secondary">{vi.loyalty.subtitle}</Txt>
      <Field label={vi.loyalty.search} value={search} onChangeText={setSearch} maxLength={40} testID="customer-search" />

      {adding ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="title">{vi.loyalty.add}</Txt>
          <Field label={vi.debts.name} value={name} onChangeText={setName} maxLength={100} testID="customer-name" />
          <Field label={vi.debts.phone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={13} testID="customer-phone" />
          {phone.replace(/\D/g, '').length > 0 ? <Checkbox label={vi.debts.consent} value={consent} onChange={setConsent} /> : null}
          {problem ? <Txt tone="danger" variant="bodyStrong">{problem}</Txt> : null}
          {add.error ? <ErrorView error={add.error} /> : null}
          <Button big label={vi.loyalty.save} onPress={save} busy={add.isPending} />
          <Button kind="link" label={vi.common.back} onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Button big={!pick} kind={pick ? 'secondary' : 'primary'} label={vi.loyalty.add} onPress={() => setAdding(true)} />
      )}

      {customers.isLoading ? <Loading /> : null}
      {customers.error ? <ErrorView error={customers.error} onRetry={() => void customers.refetch()} /> : null}
      {choose.error ? <ErrorView error={choose.error} /> : null}
      {customers.data && rows.length === 0 ? <Empty text={vi.loyalty.empty} /> : null}
      {rows.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          accessibilityLabel={`${c.display_name}, ${vi.loyalty.points(c.points)}`}
          onPress={() => (pick ? choose.mutate(c) : router.push({ pathname: '/khach-quen/[id]', params: { id: c.id } }))}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{c.display_name}</Txt>
              <Txt variant="small" tone="secondary">
                {[c.phone_number, vi.loyalty.visits(c.visits), formatVND(c.total_spent)].filter(Boolean).join(' · ')}
              </Txt>
            </View>
            <Txt variant="bodyStrong" tone="primary">
              {vi.loyalty.points(c.points)}
            </Txt>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
