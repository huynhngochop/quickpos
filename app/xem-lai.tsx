import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card } from '../src/components/Screen';
import { Amount, Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ErrorView, Loading } from '../src/components/States';
import { canManage, useBusinessId, useSession } from '../src/features/session/store';
import { useReview } from '../src/features/review/hooks';
import type { ReviewEvent } from '../src/features/review/api';
import { bankDisplayName } from '../src/lib/banks';
import { formatVND } from '../src/lib/money';
import { formatTimeVN } from '../src/lib/time';
import { font, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/** 3.2 Tiền cần xem lại — chỉ chủ quán/quản lý/kế toán (RLS chặn phía server, PIN chặn trên máy). */
export default function XemLai() {
  const businessId = useBusinessId();
  const role = useSession((s) => s.role);
  const { events, manual } = useReview(businessId, true);
  const all = events.data ?? [];
  const unmatched = all.filter((e) => e.match_status === 'UNMATCHED');
  const partial = all.filter((e) => e.match_status === 'PARTIAL');
  const twice = all.filter((e) => e.match_status === 'ALREADY_PAID');
  const manualRows = manual.data ?? [];
  const loading = events.isLoading || manual.isLoading;
  const empty = !loading && all.length === 0 && manualRows.length === 0;

  return (
    <Screen back={{ label: vi.common.home, href: '/trang-chinh' }} maxWidth={720}>
      <Txt variant="heading">{vi.review.title}</Txt>
      <Txt tone="secondary">{vi.review.ownerOnly}</Txt>
      {loading ? <Loading /> : null}
      {events.error ? <ErrorView error={events.error} onRetry={() => void events.refetch()} /> : null}
      {manual.error ? <ErrorView error={manual.error} onRetry={() => void manual.refetch()} /> : null}
      {empty ? (
        <Card tone="success">
          <Txt tone="success" variant="bodyStrong">
            {vi.review.allClear}
          </Txt>
        </Card>
      ) : null}

      {unmatched.length > 0 ? <Section title={vi.review.unmatched(unmatched.length)} /> : null}
      {unmatched.map((e) => (
        <EventCard key={e.id} e={e}>
          {canManage(role) ? (
            <Button label={vi.review.assign} onPress={() => router.push({ pathname: '/gan-don/[eventId]', params: { eventId: e.id } })} />
          ) : null}
        </EventCard>
      ))}

      {manualRows.length > 0 ? <Section title={vi.review.manual(manualRows.length)} /> : null}
      {manualRows.map((m) => (
        <Card key={m.id} tone="warn">
          <Amount value={formatVND(m.total_amount)} size={font.size.amountSmall} center={false} />
          <Txt tone="warn">{vi.review.manualOf(m.order_code, formatTimeVN(m.manual_confirmed_at))}</Txt>
          {m.manual_note ? <Txt variant="small" tone="warn">{vi.review.note(m.manual_note)}</Txt> : null}
        </Card>
      ))}

      {partial.length > 0 ? <Section title={vi.review.partial(partial.length)} /> : null}
      {partial.map((e) => (
        <EventCard key={e.id} e={e} />
      ))}

      {twice.length > 0 ? <Section title={vi.review.twice(twice.length)} /> : null}
      {twice.map((e) => (
        <EventCard key={e.id} e={e}>
          <Txt variant="bodyStrong" tone="danger">
            {vi.review.refund(e.order?.order_code ?? '', formatVND(e.amount))}
          </Txt>
        </EventCard>
      ))}
    </Screen>
  );
}

function Section({ title }: { title: string }) {
  return (
    <Txt variant="title" style={{ marginTop: space.md }}>
      {title}
    </Txt>
  );
}

function EventCard({ e, children }: { e: ReviewEvent; children?: ReactNode }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Amount value={formatVND(e.amount)} size={font.size.amountSmall} center={false} />
        <Txt tone="secondary">{formatTimeVN(e.received_at)}</Txt>
      </View>
      <Txt variant="small" tone="secondary">
        {[e.bank_bin ? bankDisplayName(e.bank_bin) : null, e.transfer_content ? vi.review.from(e.transfer_content) : null].filter(Boolean).join(' · ')}
      </Txt>
      {children}
    </Card>
  );
}
