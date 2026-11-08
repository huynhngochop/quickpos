import { useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { ErrorView } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useSuppliers } from '../../src/features/shop/hooks';
import { upsertSupplier } from '../../src/features/shop/api';
import { newId } from '../../src/lib/device';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

/** 6.6b Thêm / sửa nhà cung cấp (?id= để sửa). */
export default function ThemNhaCungCap() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const qc = useQueryClient();
  const all = useSuppliers(businessId);
  const cur = id ? (all.data ?? []).find((s) => s.id === id) : undefined;
  const supplierId = useRef(id ?? newId());
  const [name, setName] = useState(cur?.name ?? '');
  const [phone, setPhone] = useState(cur?.phone ?? '');
  const [address, setAddress] = useState(cur?.address ?? '');
  const [taxCode, setTaxCode] = useState(cur?.tax_code ?? '');
  const [note, setNote] = useState(cur?.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!id);
  if (!loaded && cur) {
    setLoaded(true);
    setName(cur.name);
    setPhone(cur.phone ?? '');
    setAddress(cur.address ?? '');
    setTaxCode(cur.tax_code ?? '');
    setNote(cur.note ?? '');
  }

  const save = useMutation({
    mutationFn: () =>
      upsertSupplier({ supplierId: supplierId.current, businessId, name: name.trim(), phone: phone.trim(), address: address.trim(), taxCode: taxCode.trim(), note: note.trim() }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['suppliers', businessId] });
      if (id) router.back();
      else router.replace({ pathname: '/nha-cung-cap/[id]', params: { id: s.id } });
    },
  });

  return (
    <Screen back={{ label: vi.inv.suppliers, href: '/nha-cung-cap' }} maxWidth={720}>
      <Txt variant="heading">{id ? vi.inv.editSupplier : vi.inv.addSupplier}</Txt>
      {!manage ? (
        <Txt tone="secondary">{vi.errors.QP_FORBIDDEN}</Txt>
      ) : (
        <Card style={{ gap: space.md }}>
          <Field label={vi.inv.supplierName} value={name} onChangeText={setName} maxLength={100} testID="supplier-name" />
          <Field label={vi.inv.supplierPhone} value={phone} onChangeText={(v) => setPhone(v.slice(0, 20))} keyboardType="phone-pad" testID="supplier-phone" />
          <Field label={vi.inv.supplierAddress} value={address} onChangeText={setAddress} maxLength={200} testID="supplier-address" />
          <Field label={vi.inv.supplierTaxCode} value={taxCode} onChangeText={(v) => setTaxCode(v.slice(0, 14))} keyboardType="number-pad" testID="supplier-tax" />
          <Field label={vi.inv.supplierNote} value={note} onChangeText={setNote} maxLength={200} testID="supplier-note" />
          {problem ? <Txt tone="danger">{problem}</Txt> : null}
          {save.error ? <ErrorView error={save.error} /> : null}
          <Button
            big
            label={vi.inv.saveSupplier}
            busy={save.isPending}
            onPress={() => {
              if (!name.trim()) return setProblem(vi.inv.enterSupplierName);
              setProblem(null);
              save.mutate();
            }}
          />
        </Card>
      )}
    </Screen>
  );
}
