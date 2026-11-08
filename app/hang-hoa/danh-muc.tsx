import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ChoiceGrid, Field } from '../../src/components/Choice';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { Checkbox, Empty, ErrorView, Loading } from '../../src/components/States';
import { canManage, useBusinessId, useSession } from '../../src/features/session/store';
import { useCategories, useProducts } from '../../src/features/shop/hooks';
import { archiveCategory, upsertCategory } from '../../src/features/shop/api';
import { newId } from '../../src/lib/device';
import { space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';
import type { Category, TaxGroup } from '../../src/types/api';

const SAME = 'SAME';
const GROUPS: TaxGroup[] = ['GOODS', 'SERVICE', 'LEASING', 'PRODUCTION', 'DIGITAL', 'OTHER'];

/**
 * 6.5 Danh mục hàng hóa: thêm, đổi tên, nhóm ngành khi kê khai thuế (quán bán cả hàng hóa lẫn ăn uống),
 * hàng có hạn dùng mặc định, bỏ danh mục (hàng chuyển sang "Chưa phân loại").
 */
export default function DanhMuc() {
  const businessId = useBusinessId();
  const manage = canManage(useSession((s) => s.role));
  const qc = useQueryClient();
  const cats = useCategories(businessId);
  const products = useProducts(businessId, true);
  const [editing, setEditing] = useState<Category | 'NEW' | null>(null);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<string>(SAME);
  const [expiry, setExpiry] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [askHide, setAskHide] = useState<Category | null>(null);

  const open = (c: Category | 'NEW') => {
    setEditing(c);
    setProblem(null);
    setName(c === 'NEW' ? '' : c.name);
    setGroup(c === 'NEW' ? SAME : c.tax_group ?? SAME);
    setExpiry(c === 'NEW' ? false : c.track_expiry_default);
  };
  const done = () => {
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ['products', businessId] });
  };
  const save = useMutation({
    mutationFn: () =>
      upsertCategory({
        categoryId: editing === 'NEW' || !editing ? newId() : editing.id, businessId, name: name.trim(),
        sortOrder: editing === 'NEW' || !editing ? cats.data?.length ?? 0 : editing.sort_order,
        taxGroup: group === SAME ? null : (group as TaxGroup), trackExpiryDefault: expiry,
      }),
    onSuccess: done,
  });
  const hide = useMutation({
    mutationFn: (c: Category) => archiveCategory(c.id),
    onSuccess: () => {
      setAskHide(null);
      done();
    },
  });
  const countOf = (id: string) => (products.data ?? []).filter((p) => p.category_id === id).length;

  return (
    <Screen back={{ label: vi.catalog.title, href: '/hang-hoa' }} maxWidth={720}>
      <Txt variant="heading">{vi.inv.categoriesTitle}</Txt>
      <Txt tone="secondary">{vi.inv.categoriesHelp}</Txt>
      {!manage ? <Txt tone="secondary">{vi.errors.QP_FORBIDDEN}</Txt> : null}
      {manage && editing ? (
        <Card style={{ gap: space.md }}>
          <Field label={vi.inv.newCategory} value={name} onChangeText={setName} maxLength={50} testID="category-name" />
          <Txt variant="bodyStrong">{vi.inv.categoryTaxGroup}</Txt>
          <ChoiceGrid
            options={[{ key: SAME, label: vi.inv.categoryTaxSame }, ...GROUPS.map((g) => ({ key: g, label: vi.inv.taxGroups[g] ?? g }))]}
            value={group}
            onChange={setGroup}
            columns={1}
            testIdPrefix="category-tax"
          />
          <Checkbox label={vi.inv.categoryExpiryDefault} value={expiry} onChange={setExpiry} />
          {problem ? <Txt tone="danger">{problem}</Txt> : null}
          {save.error ? <ErrorView error={save.error} /> : null}
          <Button
            big
            label={vi.inv.saveCategory}
            busy={save.isPending}
            onPress={() => {
              if (!name.trim()) return setProblem(vi.inv.enterCategoryName);
              setProblem(null);
              save.mutate();
            }}
          />
          <Button kind="link" label={vi.common.back} onPress={() => setEditing(null)} />
        </Card>
      ) : manage ? (
        <Button big label={vi.inv.addCategory} onPress={() => open('NEW')} testID="add-category" />
      ) : null}

      {cats.isLoading ? <Loading /> : null}
      {cats.error ? <ErrorView error={cats.error} onRetry={() => void cats.refetch()} /> : null}
      {cats.data && cats.data.length === 0 ? <Empty text={vi.inv.categoryEmpty} /> : null}
      {(cats.data ?? []).map((c) => (
        <Card key={c.id} style={{ gap: space.sm }}>
          <Pressable accessibilityRole="button" accessibilityLabel={c.name} onPress={() => manage && open(c)}>
            <Txt variant="bodyStrong">{c.name}</Txt>
            <Txt variant="small" tone="secondary">
              {[vi.inv.categoryProducts(countOf(c.id)), c.tax_group ? vi.inv.taxGroups[c.tax_group] : null].filter(Boolean).join(' · ')}
            </Txt>
          </Pressable>
          {manage ? (
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button kind="secondary" label={vi.catalog.tabEdit} onPress={() => open(c)} style={{ flex: 1 }} />
              <Button kind="dangerOutline" label={vi.inv.hideCategory} onPress={() => setAskHide(c)} style={{ flex: 1 }} />
            </View>
          ) : null}
        </Card>
      ))}
      {hide.error ? <ErrorView error={hide.error} /> : null}
      <ConfirmSheet
        visible={!!askHide}
        title={askHide ? vi.inv.hideCategoryAsk(askHide.name) : ''}
        body={vi.inv.hideCategoryBody}
        yes={vi.inv.hideYes}
        no={vi.common.back}
        danger
        busy={hide.isPending}
        onYes={() => askHide && hide.mutate(askHide)}
        onNo={() => setAskHide(null)}
      />
    </Screen>
  );
}
