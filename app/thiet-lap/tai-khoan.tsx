import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Card } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { ErrorView, Loading, callSupport } from '../../src/components/States';
import { mainPaymentAccount } from '../../src/features/session/api';
import { useBusinessId } from '../../src/features/session/store';
import { bankDisplayName } from '../../src/lib/banks';
import { vi } from '../../src/i18n/vi';

/**
 * Bước 2/3 — Tài khoản nhận tiền. App KHÔNG cho gõ số tài khoản (CLAUDE.md): tài khoản được ghi
 * vào payment_accounts bởi server sau khi cổng thanh toán xác minh. Ở đây chỉ hiện trạng thái.
 * TODO: luồng chọn ngân hàng → cổng xác minh (Edge Function connect-payment-account) khi có tài liệu sandbox của cổng.
 */
export default function ThietLapTaiKhoan() {
  const businessId = useBusinessId();
  const q = useQuery({ queryKey: ['account', businessId], queryFn: () => mainPaymentAccount(businessId), refetchInterval: 10_000 });
  const next = () => router.replace('/thiet-lap/pin');

  return (
    <Screen
      footer={
        q.data ? (
          <Button big label={vi.setup.accountUse} onPress={next} />
        ) : (
          <>
            <Button big kind="secondary" label={vi.setup.accountAskHelp} onPress={callSupport} />
            <Button kind="link" label={vi.setup.accountSkip} onPress={next} />
          </>
        )
      }
    >
      <Txt variant="bodyStrong" tone="secondary">
        {vi.setup.step(2)}
      </Txt>
      <Txt variant="heading">{vi.setup.accountTitle}</Txt>
      <Txt tone="secondary">{vi.setup.accountBody}</Txt>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <Card tone="success">
          <Txt variant="bodyStrong" tone="success">
            {vi.setup.accountFound}
          </Txt>
          <Txt variant="title">{`${bankDisplayName(q.data.bank_bin)} · ${q.data.account_no}`}</Txt>
        </Card>
      ) : q.isSuccess ? (
        <Card tone="warn">
          <Txt variant="bodyStrong" tone="warn">
            {vi.setup.accountWaiting}
          </Txt>
          <Txt variant="small" tone="warn">
            {vi.setup.accountWaitingBody}
          </Txt>
        </Card>
      ) : null}
    </Screen>
  );
}
