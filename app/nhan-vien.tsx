import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { ErrorView, Loading, SupportLink } from '../src/components/States';
import { useBusinessId, useSession } from '../src/features/session/store';
import { listMembers } from '../src/features/session/api';
import { colors, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';

/**
 * 4.3 Nhân viên — bản đầu chỉ xem danh sách vai trò.
 * TODO (cần API mới trong docs/api.md): mời thu ngân bằng số điện thoại, tên hiển thị, khóa/mở tài khoản.
 * Bảng business_members chưa có tên, và app không đọc được auth.users.
 */
export default function NhanVien() {
  const businessId = useBusinessId();
  const me = useSession((s) => s.userId);
  const q = useQuery({ queryKey: ['members', businessId], queryFn: () => listMembers(businessId) });

  return (
    <Screen back={{ label: vi.settings.title }} footer={<SupportLink label={vi.staff.addSoon} />}>
      <Txt variant="heading">{vi.staff.title}</Txt>
      <Txt tone="secondary">{vi.staff.body}</Txt>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => void q.refetch()} /> : null}
      {(q.data ?? []).map((m, i) => (
        <Card key={m.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="title" tone="primary" maxFontSizeMultiplier={1.2}>
              {String(i + 1)}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{vi.staff.roles[m.role] ?? m.role}</Txt>
            {m.user_id === me ? (
              <Txt variant="small" tone="secondary">
                {vi.staff.you}
              </Txt>
            ) : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
