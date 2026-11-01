import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Card } from '../src/components/Screen';
import { Txt } from '../src/components/Txt';
import { Button } from '../src/components/Button';
import { ChoiceGrid, Field } from '../src/components/Choice';
import { ConfirmSheet } from '../src/components/ConfirmSheet';
import { ErrorView, Loading } from '../src/components/States';
import { useBusinessId, useSession } from '../src/features/session/store';
import { listMembers } from '../src/features/session/api';
import { inviteMember, listInvites, removeMember, revokeInvite, setMemberRole } from '../src/features/shop/api';
import { formatPhoneVN } from '../src/lib/money';
import { newId } from '../src/lib/device';
import { colors, space } from '../src/theme/tokens';
import { vi } from '../src/i18n/vi';
import type { Role } from '../src/types/api';

type StaffRole = 'CASHIER' | 'MANAGER' | 'ACCOUNTANT';
const ROLES: StaffRole[] = ['CASHIER', 'MANAGER', 'ACCOUNTANT'];
const authToLocal = (p: string) => (p.startsWith('84') ? `0${p.slice(2)}` : p);

/**
 * 4.3 Nhân viên: danh sách, mời bằng số điện thoại (người đó đăng nhập app bằng số này là vào quán),
 * đổi quyền, cho nghỉ, thu hồi lời mời. Chỉ chủ quán đổi được.
 */
export default function NhanVien() {
  const businessId = useBusinessId();
  const me = useSession((s) => s.userId);
  const myRole = useSession((s) => s.role);
  const owner = myRole === 'OWNER';
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['members', businessId], queryFn: () => listMembers(businessId) });
  const invites = useQuery({ queryKey: ['invites', businessId], queryFn: () => listInvites(businessId), enabled: owner || myRole === 'MANAGER' });
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('CASHIER');
  const [msg, setMsg] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const inviteId = useRef(newId());
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['members', businessId] });
    void qc.invalidateQueries({ queryKey: ['invites', businessId] });
  };

  const invite = useMutation({
    mutationFn: () => inviteMember(inviteId.current, businessId, phone.replace(/\D/g, ''), role),
    onSuccess: () => {
      inviteId.current = newId();
      setMsg(vi.staff.invited(formatPhoneVN(phone)));
      setPhone('');
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => revokeInvite(id), onSuccess: refresh });
  const change = useMutation({ mutationFn: (v: { userId: string; role: Role }) => setMemberRole(businessId, v.userId, v.role), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (userId: string) => removeMember(businessId, userId), onSuccess: () => { setRemoveId(null); refresh(); } });

  const send = () => {
    setMsg(null);
    if (!/^0[0-9]{9}$/.test(phone.replace(/\D/g, ''))) return setMsg(vi.staff.phoneWrong);
    invite.mutate();
  };

  return (
    <Screen back={{ label: vi.common.back }} maxWidth={640}>
      <Txt variant="heading">{vi.staff.title}</Txt>
      <Txt tone="secondary">{vi.staff.body}</Txt>
      {members.isLoading ? <Loading /> : null}
      {members.error ? <ErrorView error={members.error} onRetry={() => void members.refetch()} /> : null}
      {(members.data ?? []).map((m, i) => (
        <Card key={m.user_id} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Txt variant="title" tone="primary" maxFontSizeMultiplier={1.2}>
                {String(i + 1)}
              </Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{vi.staff.roles[m.role] ?? m.role}</Txt>
              <Txt variant="small" tone="secondary">
                {m.user_id === me ? vi.staff.you : m.member_phone ? formatPhoneVN(m.member_phone) : ''}
              </Txt>
            </View>
          </View>
          {owner && m.role !== 'OWNER' ? (
            <>
              <ChoiceGrid
                options={ROLES.map((r) => ({ key: r, label: vi.staff.roles[r]! }))}
                value={m.role as StaffRole}
                onChange={(r) => change.mutate({ userId: m.user_id, role: r })}
                columns={3}
              />
              <Button kind="link" label={vi.staff.remove} onPress={() => setRemoveId(m.user_id)} />
            </>
          ) : null}
        </Card>
      ))}
      {change.error ? <ErrorView error={change.error} /> : null}

      {owner ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="title">{vi.staff.invite}</Txt>
          <Field label={vi.staff.phone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={13} testID="invite-phone" />
          <Txt variant="bodyStrong">{vi.staff.role}</Txt>
          <ChoiceGrid options={ROLES.map((r) => ({ key: r, label: vi.staff.roles[r]! }))} value={role} onChange={setRole} columns={3} testIdPrefix="invite-role" />
          <Txt variant="small" tone="secondary">
            {vi.staff.roleHelp[role]}
          </Txt>
          {msg ? <Txt tone={invite.isSuccess ? 'success' : 'danger'} variant="bodyStrong">{msg}</Txt> : null}
          {invite.error ? <ErrorView error={invite.error} /> : null}
          <Button big label={vi.staff.sendInvite} onPress={send} busy={invite.isPending} />
        </Card>
      ) : null}

      {(invites.data ?? []).length > 0 ? <Txt variant="title">{vi.staff.pending}</Txt> : null}
      {(invites.data ?? []).map((iv) => (
        <Card key={iv.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{formatPhoneVN(authToLocal(iv.phone))}</Txt>
            <Txt variant="small" tone="secondary">
              {`${vi.staff.roles[iv.role] ?? iv.role} · ${vi.staff.waiting}`}
            </Txt>
          </View>
          {owner ? <Button kind="link" label={vi.staff.revoke} onPress={() => revoke.mutate(iv.id)} /> : null}
        </Card>
      ))}
      <ConfirmSheet
        visible={removeId !== null}
        title={vi.staff.removeAsk}
        body={vi.staff.removeBody}
        yes={vi.staff.removeYes}
        no={vi.staff.removeNo}
        danger
        busy={remove.isPending}
        onYes={() => removeId && remove.mutate(removeId)}
        onNo={() => setRemoveId(null)}
      />
    </Screen>
  );
}
