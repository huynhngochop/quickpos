import { Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '../theme/tokens';
import { Txt } from './Txt';
import { Button } from './Button';

/** Hỏi lại trước thao tác quan trọng. Hai nút to có chữ, không dựa vào vuốt để đóng. */
export function ConfirmSheet({
  visible,
  title,
  body,
  yes,
  no,
  danger,
  busy,
  onYes,
  onNo,
}: {
  visible: boolean;
  title: string;
  body?: string;
  yes: string;
  no: string;
  danger?: boolean;
  busy?: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNo} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(22,25,29,0.55)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.ground,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: space.gutter,
            paddingBottom: space.gutter + insets.bottom,
            gap: space.md,
            width: '100%',
            maxWidth: 560,
            alignSelf: 'center',
          }}
          accessibilityViewIsModal
        >
          <Txt variant="title">{title}</Txt>
          {body ? <Txt tone="secondary">{body}</Txt> : null}
          <Button big kind={danger ? 'danger' : 'primary'} label={yes} onPress={onYes} busy={busy} />
          <Button kind="secondary" label={no} onPress={onNo} />
        </View>
      </View>
    </Modal>
  );
}
