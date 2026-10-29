import { useRef, useState } from 'react';
import { TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Screen } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ErrorView } from '../../src/components/States';
import { createBusiness } from '../../src/features/session/api';
import { useSession } from '../../src/features/session/store';
import { newId } from '../../src/lib/device';
import { colors, font, radius, space } from '../../src/theme/tokens';
import { vi } from '../../src/i18n/vi';

const schema = z.object({
  name: z.string().trim().min(1, vi.setup.nameRequired).max(200),
  taxCode: z
    .string()
    .transform((s) => s.replace(/\s/g, ''))
    .pipe(z.string().regex(/^[0-9]{10}([0-9]{2}|-[0-9]{3})?$/, vi.setup.taxInvalid)),
  address: z.string().trim().min(1, vi.setup.addressRequired).max(500),
});
type Form = z.input<typeof schema>;

/** Bước 1/3 — Thông tin quán (tạo hộ bằng create_business_v1, gửi lại an toàn). */
export default function ThietLapQuan() {
  // Mã quán sinh một lần cho màn hình này: bấm lại / mạng chập chờn không tạo 2 quán
  const businessId = useRef(newId()).current;
  const [error, setError] = useState<unknown>(null);
  const { control, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', taxCode: '', address: '' },
  });

  const onSubmit = handleSubmit(async (raw) => {
    setError(null);
    const v = schema.parse(raw);
    try {
      const business = await createBusiness({ id: businessId, name: v.name, taxCode: v.taxCode, address: v.address });
      useSession.getState().set({ business, role: 'OWNER' });
      router.replace('/thiet-lap/tai-khoan');
    } catch (e) {
      setError(e);
    }
  });

  return (
    <Screen footer={<Button big label={vi.setup.next} onPress={onSubmit} busy={formState.isSubmitting} />}>
      <Txt variant="bodyStrong" tone="secondary">
        {vi.setup.step(1)}
      </Txt>
      <Txt variant="heading">{vi.setup.shopTitle}</Txt>
      <Txt tone="secondary">{vi.setup.shopBody}</Txt>
      <Field control={control} name="name" label={vi.setup.shopName} error={formState.errors.name?.message} />
      <Field
        control={control}
        name="taxCode"
        label={vi.setup.taxCode}
        hint={vi.setup.taxCodeHint}
        keyboardType="number-pad"
        error={formState.errors.taxCode?.message}
      />
      <Field control={control} name="address" label={vi.setup.address} multiline error={formState.errors.address?.message} />
      {error ? <ErrorView error={error} /> : null}
    </Screen>
  );
}

function Field({
  control,
  name,
  label,
  hint,
  error,
  keyboardType,
  multiline,
}: {
  control: ReturnType<typeof useForm<Form>>['control'];
  name: 'name' | 'taxCode' | 'address';
  label: string;
  hint?: string;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="bodyStrong" nativeID={`f-${name}`}>
        {label}
      </Txt>
      {hint ? (
        <Txt variant="small" tone="secondary">
          {hint}
        </Txt>
      ) : null}
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <TextInput
            accessibilityLabelledBy={`f-${name}`}
            testID={`field-${name}`}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType={keyboardType}
            multiline={multiline}
            style={{
              minHeight: 60,
              borderRadius: radius.md,
              borderWidth: 2,
              borderColor: error ? colors.danger : colors.ink,
              backgroundColor: colors.surface,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: font.size.button,
              fontFamily: font.family.medium,
              color: colors.ink,
            }}
          />
        )}
      />
      {error ? (
        <Txt tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}
