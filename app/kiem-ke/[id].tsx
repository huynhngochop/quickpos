import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { Field } from '../../src/components/Choice';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { formatQty, useStockCountDetail } from '../../src/features/shop/hooks';
import { cancelStockCount, countLine, finishStockCount } from '../../src/features/shop/api';
import { ProductPicker } from '../../src/features/shop/components/Pickers';
import { countSheetCsv } from '../../src/features/shop/inventory';
import { formatVND } from '../../src/lib/money';
import { formatDateVN } from '../../src/lib/time';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

const qtyText = (s: string) => s.replace(/[^\d,]/g, '').replace(/,(?=.*,)/g, '').slice(0, 10);
const parseQty = (s: string) => Number(s.replace(',', '.') || '0');
const signed = (n: number) => `${n > 0 ? '+' : ''}${formatQty(n)}`;

/**
 * 6.9b Một lần kiểm kê: tìm / quét món → gõ số đếm được. Thấy ngay lệch so với máy.
 * Chốt: chỉnh tồn theo chênh lệch lúc đếm (hàng bán trong lúc đếm vẫn trừ đúng). Món chưa đếm giữ nguyên.
 */
export default function MotLanKiemKe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const qc = useQueryClient();
  const d = useStockCountDetail(businessId, id);
  const [pick, setPick] = useState<{ id: string; name: string; unit: string } | null>(null);
  const [qty, setQty] = useState('');
  const [ask, setAsk] = useState<'FINISH' | 'CANCEL' | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['products', businessId] });

  const save = useMutation({
    mutationFn: () => countLine(id, pick!.id, parseQty(qty)),
    onSuccess: () => {
      setPick(null);
      setQty('');
      refresh();
    },
  });
  const close = useMutation({
    mutationFn: (what: 'FINISH' | 'CANCEL') => (what === 'FINISH' ? finishStockCount(id) : cancelStockCount(id)),
    onSuccess: () => {
      setAsk(null);
      refresh();
    },
  });

  const data = d.data;
  const open = data?.count.status === 'OPEN';
  const diffs = (data?.lines ?? []).filter((l) => l.diff !== 0);
  const hide = new Set<string>((data?.lines ?? []).map((l) => l.product_id));

  return (
    <Screen back={{ label: vi.inv.counts, href: '/kiem-ke' }} maxWidth={720}>
      {d.isLoading ? <Loading /> : null}
      {d.error ? <ErrorView error={d.error} onRetry={() => void d.refetch()} /> : null}
      {data ? (
        <>
          <Txt variant="heading">{vi.inv.countsTitle}</Txt>
          <Txt tone="secondary">
            {`${vi.inv.countStarted(formatDateVN(data.count.started_at))} · ${
              open ? vi.inv.countOpen : data.count.status === 'DONE' ? vi.inv.countDone : vi.inv.countCancelled
            }`}
          </Txt>
          {data.count.status === 'DONE' ? (
            <Card tone="success" style={{ gap: space.xs }}>
              <Txt tone="success" variant="bodyStrong">{`✓ ${vi.inv.countFinished}`}</Txt>
              <Txt>{vi.inv.countSummary(data.count.lines_total, data.count.lines_diff)}</Txt>
              <Txt>{vi.inv.countValue(formatVND(data.count.value_diff))}</Txt>
            </Card>
          ) : null}

          {open ? (
            <Card style={{ gap: space.md }}>
              {pick ? (
                <>
                  <Txt variant="title">{pick.name}</Txt>
                  <Field label={vi.inv.countQty(pick.unit)} value={qty} onChangeText={(v) => setQty(qtyText(v))} keyboardType="decimal-pad" testID="count-qty" />
                  {save.error ? <ErrorView error={save.error} /> : null}
                  <Button big label={vi.inv.countSave} onPress={() => qty !== '' && save.mutate()} busy={save.isPending} testID="count-save" />
                  <Button kind="link" label={vi.common.back} onPress={() => setPick(null)} />
                </>
              ) : (
                <ProductPicker
                  businessId={businessId}
                  label={vi.inv.countFind}
                  hide={hide}
                  onPick={(p) => {
                    setPick({ id: p.id, name: p.name, unit: p.unit });
                    setQty('');
                  }}
                  testID="count-search"
                />
              )}
            </Card>
          ) : null}

          {data.lines.length > 0 ? <Txt variant="title">{`${vi.inv.counted} (${data.lines.length})`}</Txt> : null}
          {data.lines.map((l) => (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              accessibilityLabel={`${l.name}, ${vi.inv.diffLine(formatQty(l.expected_qty), formatQty(l.counted_qty), l.diff === 0 ? vi.inv.diffZero : signed(l.diff))}`}
              onPress={() => {
                if (!open) return;
                setPick({ id: l.product_id, name: l.name, unit: l.unit });
                setQty(formatQty(l.counted_qty));
              }}
            >
              <Card style={{ gap: space.xs }}>
                <Txt variant="bodyStrong">{l.name}</Txt>
                <Txt variant="small" tone={l.diff === 0 ? 'success' : 'warn'}>
                  {vi.inv.diffLine(formatQty(l.expected_qty), formatQty(l.counted_qty), l.diff === 0 ? vi.inv.diffZero : `${signed(l.diff)} ${l.unit}`)}
                </Txt>
              </Card>
            </Pressable>
          ))}

          {open && data.pending.length > 0 ? (
            <>
              <Txt variant="title">{vi.inv.pending(data.pending.length)}</Txt>
              <Txt variant="small" tone="secondary">
                {vi.inv.pendingNote}
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {data.pending.slice(0, 60).map((p) => (
                  <Button
                    key={p.product_id}
                    kind="secondary"
                    label={`${p.name} (${formatQty(p.stock_qty)} ${p.unit})`}
                    onPress={() => {
                      setPick({ id: p.product_id, name: p.name, unit: p.unit });
                      setQty('');
                    }}
                    testID={`count-pending-${p.name}`}
                  />
                ))}
              </View>
            </>
          ) : null}

          {open && manage ? (
            <>
              <Button big label={vi.inv.finishCount} onPress={() => setAsk('FINISH')} disabled={data.lines.length === 0} testID="finish-count" />
              <Button kind="dangerOutline" label={vi.inv.cancelCount} onPress={() => setAsk('CANCEL')} />
            </>
          ) : null}
          {close.error ? <ErrorView error={close.error} /> : null}
          {data.count.status === 'DONE' && data.lines.length > 0 ? (
            <Button
              kind="secondary"
              label={vi.inv.countShare}
              onPress={() => void Share.share({ title: vi.inv.countsTitle, message: countSheetCsv(data) })}
            />
          ) : null}
          {!open ? <Button kind="link" label={vi.inv.counts} onPress={() => router.replace('/kiem-ke')} /> : null}

          <ConfirmSheet
            visible={ask === 'FINISH'}
            title={vi.inv.finishAsk}
            body={vi.inv.finishBody(diffs.length)}
            yes={vi.inv.finishYes}
            no={vi.common.back}
            busy={close.isPending}
            onYes={() => close.mutate('FINISH')}
            onNo={() => setAsk(null)}
          />
          <ConfirmSheet
            visible={ask === 'CANCEL'}
            title={vi.inv.cancelAsk}
            body={vi.inv.cancelBody}
            yes={vi.inv.cancelYes}
            no={vi.common.back}
            danger
            busy={close.isPending}
            onYes={() => close.mutate('CANCEL')}
            onNo={() => setAsk(null)}
          />
        </>
      ) : null}
    </Screen>
  );
}
