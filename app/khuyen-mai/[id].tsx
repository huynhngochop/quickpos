import { useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ChoiceGrid, Field } from '../../src/components/Choice';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { ErrorView } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { archivePromotion, upsertPromotion, usePromotions } from '../../src/features/promo/api';
import type { PromoKind, Promotion } from '../../src/features/promo/engine';
import { CategoryPicker, ProductPicker } from '../../src/features/shop/components/Pickers';
import { useProducts } from '../../src/features/shop/hooks';
import { dayToVN, maskDate, parseDateVN } from '../../src/features/shop/inventory';
import { formatVND } from '../../src/lib/money';
import { newId } from '../../src/lib/device';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

const digits = (s: string, n = 11) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, n);
type Target = 'PRODUCT' | 'CATEGORY';
type ValueKind = 'PCT' | 'AMT';

/** 6.8b Thêm / sửa chương trình khuyến mãi (id = 'moi' để thêm). */
export default function MotKhuyenMai() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'moi';
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const qc = useQueryClient();
  const promos = usePromotions(businessId);
  const products = useProducts(businessId, true);
  const cur: Promotion | undefined = isNew ? undefined : (promos.data ?? []).find((p) => p.id === id);
  const promoId = useRef(isNew ? newId() : id);

  const [loaded, setLoaded] = useState(isNew);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PromoKind>('ITEM_DISCOUNT');
  const [target, setTarget] = useState<Target>('PRODUCT');
  const [productId, setProductId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [valueKind, setValueKind] = useState<ValueKind>('PCT');
  const [value, setValue] = useState('');
  const [buyQty, setBuyQty] = useState('');
  const [getQty, setGetQty] = useState('1');
  const [giftId, setGiftId] = useState<string | null>(null);
  const [minTotal, setMinTotal] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [active, setActive] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [askRemove, setAskRemove] = useState(false);

  if (!loaded && cur) {
    setLoaded(true);
    setName(cur.name);
    setKind(cur.kind);
    setTarget(cur.category_id ? 'CATEGORY' : 'PRODUCT');
    setProductId(cur.product_id);
    setCategoryId(cur.category_id);
    setValueKind(cur.percent != null ? 'PCT' : 'AMT');
    setValue(String(cur.percent ?? cur.amount ?? ''));
    setBuyQty(cur.buy_qty ? String(cur.buy_qty) : '');
    setGetQty(cur.get_qty ? String(cur.get_qty) : '1');
    setGiftId(cur.get_product_id && cur.get_product_id !== cur.product_id ? cur.get_product_id : null);
    setMinTotal(cur.min_total ? String(cur.min_total) : '');
    setStarts(cur.starts_on ? dayToVN(cur.starts_on) : '');
    setEnds(cur.ends_on ? dayToVN(cur.ends_on) : '');
    setActive(cur.is_active);
  }

  const nameOf = (pid: string | null) => (products.data ?? []).find((p) => p.id === pid)?.name ?? '';
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['promotions', businessId] });
    router.back();
  };
  const save = useMutation({
    mutationFn: (isActive: boolean) => {
      const v = Number(value || '0');
      return upsertPromotion({
        promotionId: promoId.current, businessId, name: name.trim(), kind, isActive,
        productId: kind === 'ORDER_DISCOUNT' || (kind === 'ITEM_DISCOUNT' && target === 'CATEGORY') ? null : productId,
        categoryId: kind === 'ITEM_DISCOUNT' && target === 'CATEGORY' ? categoryId : null,
        percent: kind !== 'BUY_X_GET_Y' && valueKind === 'PCT' ? v : null,
        amount: kind !== 'BUY_X_GET_Y' && valueKind === 'AMT' ? v : null,
        buyQty: kind === 'BUY_X_GET_Y' ? Number(buyQty) : null,
        getQty: kind === 'BUY_X_GET_Y' ? Number(getQty) : null,
        getProductId: kind === 'BUY_X_GET_Y' ? giftId ?? productId : null,
        minTotal: kind === 'ORDER_DISCOUNT' ? Number(minTotal || '0') : null,
        startsOn: starts ? parseDateVN(starts) : null,
        endsOn: ends ? parseDateVN(ends) : null,
      });
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => archivePromotion(promoId.current), onSuccess: done });

  const submit = (isActive = active) => {
    const v = Number(value || '0');
    const bad =
      !name.trim() ||
      (starts && !parseDateVN(starts)) ||
      (ends && !parseDateVN(ends)) ||
      (kind === 'ITEM_DISCOUNT' && (target === 'PRODUCT' ? !productId : !categoryId)) ||
      (kind !== 'BUY_X_GET_Y' && (valueKind === 'PCT' ? !(v >= 1 && v <= 100) : !(v > 0))) ||
      (kind === 'BUY_X_GET_Y' && (!productId || !(Number(buyQty) >= 1) || !(Number(getQty) >= 1)));
    if (bad) return setProblem(vi.inv.promoCheck);
    setProblem(null);
    save.mutate(isActive);
  };

  if (!manage) {
    return (
      <Screen back={{ label: vi.inv.promos, href: '/khuyen-mai' }} maxWidth={720}>
        <Txt tone="secondary">{vi.errors.QP_FORBIDDEN}</Txt>
      </Screen>
    );
  }

  const productChooser = (label: string, value: string | null, set: (v: string | null) => void, testID: string, allowNone?: string) => (
    <View style={{ gap: space.sm }}>
      <Txt variant="bodyStrong">{label}</Txt>
      {value ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Txt variant="bodyStrong" tone="primary" style={{ flex: 1 }}>
            {nameOf(value)}
          </Txt>
          <Button kind="link" label={vi.inv.changePick} onPress={() => set(null)} />
        </View>
      ) : (
        <>
          {allowNone ? <Txt variant="small" tone="secondary">{allowNone}</Txt> : null}
          <ProductPicker businessId={businessId} onPick={(p) => set(p.id)} label={vi.inv.pickProduct} testID={testID} />
        </>
      )}
    </View>
  );

  return (
    <Screen back={{ label: vi.inv.promos, href: '/khuyen-mai' }} maxWidth={720}>
      <Txt variant="heading">{isNew ? vi.inv.addPromo : name}</Txt>
      <Card style={{ gap: space.md }}>
        <Field label={vi.inv.promoName} value={name} onChangeText={setName} maxLength={80} testID="promo-name" />
        <Txt variant="bodyStrong">{vi.inv.promoKind}</Txt>
        <ChoiceGrid
          options={(['ITEM_DISCOUNT', 'BUY_X_GET_Y', 'ORDER_DISCOUNT'] as PromoKind[]).map((k) => ({ key: k, label: vi.inv.promoKinds[k] ?? k }))}
          value={kind}
          onChange={setKind}
          columns={1}
          testIdPrefix="promo-kind"
        />

        {kind === 'ITEM_DISCOUNT' ? (
          <>
            <Txt variant="bodyStrong">{vi.inv.promoTarget}</Txt>
            <ChoiceGrid
              options={[
                { key: 'PRODUCT' as Target, label: vi.inv.promoTargetProduct },
                { key: 'CATEGORY' as Target, label: vi.inv.promoTargetCategory },
              ]}
              value={target}
              onChange={setTarget}
              columns={2}
              testIdPrefix="promo-target"
            />
            {target === 'PRODUCT' ? (
              productChooser(vi.inv.pickProduct, productId, setProductId, 'promo-product')
            ) : (
              <CategoryPicker businessId={businessId} value={categoryId} onChange={(cid) => setCategoryId(cid)} />
            )}
          </>
        ) : null}

        {kind === 'BUY_X_GET_Y' ? (
          <>
            {productChooser(vi.inv.pickProduct, productId, setProductId, 'promo-product')}
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Field label={vi.inv.promoBuyQty} value={buyQty} onChangeText={(v) => setBuyQty(digits(v, 4))} keyboardType="number-pad" testID="promo-buy" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={vi.inv.promoGetQty} value={getQty} onChangeText={(v) => setGetQty(digits(v, 4))} keyboardType="number-pad" testID="promo-get" />
              </View>
            </View>
            {productChooser(vi.inv.promoGetProduct, giftId, setGiftId, 'promo-gift', vi.inv.promoSameProduct)}
          </>
        ) : null}

        {kind !== 'BUY_X_GET_Y' ? (
          <>
            <Txt variant="bodyStrong">{vi.inv.promoValueKind}</Txt>
            <ChoiceGrid
              options={[
                { key: 'PCT' as ValueKind, label: vi.inv.promoPercent },
                { key: 'AMT' as ValueKind, label: vi.inv.promoAmount },
              ]}
              value={valueKind}
              onChange={(k) => {
                setValueKind(k);
                setValue('');
              }}
              columns={2}
              testIdPrefix="promo-value-kind"
            />
            <Field
              label={valueKind === 'PCT' ? vi.inv.promoPercentField : kind === 'ITEM_DISCOUNT' ? vi.inv.promoAmountItemField : vi.inv.promoAmountOrderField}
              value={value}
              onChangeText={(v) => setValue(digits(v, valueKind === 'PCT' ? 3 : 10))}
              keyboardType="number-pad"
              testID="promo-value"
            />
            {valueKind === 'AMT' && value ? <Txt tone="secondary">{formatVND(Number(value))}</Txt> : null}
          </>
        ) : null}

        {kind === 'ORDER_DISCOUNT' ? (
          <Field label={vi.inv.promoMinTotal} value={minTotal} onChangeText={(v) => setMinTotal(digits(v))} keyboardType="number-pad" testID="promo-min" />
        ) : null}

        <Field label={vi.inv.promoStarts} value={starts} onChangeText={(v) => setStarts(maskDate(v))} keyboardType="number-pad" maxLength={10} testID="promo-starts" />
        <Field label={vi.inv.promoEnds} value={ends} onChangeText={(v) => setEnds(maskDate(v))} keyboardType="number-pad" maxLength={10} testID="promo-ends" />
        {problem ? (
          <Txt tone="danger" variant="bodyStrong">
            {problem}
          </Txt>
        ) : null}
        {save.error ? <ErrorView error={save.error} /> : null}
        <Button big label={vi.inv.savePromo} onPress={() => submit()} busy={save.isPending} testID="save-promo" />
      </Card>
      {!isNew ? (
        <>
          <Button kind="secondary" label={active ? vi.inv.pausePromo : vi.inv.resumePromo} onPress={() => submit(!active)} />
          <Button kind="dangerOutline" label={vi.inv.removePromo} onPress={() => setAskRemove(true)} />
          {remove.error ? <ErrorView error={remove.error} /> : null}
        </>
      ) : null}
      <ConfirmSheet
        visible={askRemove}
        title={vi.inv.removePromoAsk(name)}
        body={vi.inv.removePromoBody}
        yes={vi.inv.removePromoYes}
        no={vi.common.back}
        danger
        busy={remove.isPending}
        onYes={() => remove.mutate()}
        onNo={() => setAskRemove(false)}
      />
    </Screen>
  );
}
