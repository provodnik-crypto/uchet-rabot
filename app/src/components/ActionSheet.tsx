import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, sheetHandle, space, stroke, touch } from '../theme';
import { Text } from './Text';

export type SheetAction = { label: string; onPress: () => void; danger?: boolean; hint?: string };

/** Шторка снизу с редкими действиями (меню «⋯», своя работа). Нажатие мимо или «Отмена» — закрыть. */
export function ActionSheet({ visible, title, actions, onClose }: { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Закрыть" onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s12 }]}>
          <View style={styles.handle} />
          {title ? (
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {actions.map((a) => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                a.onPress();
              }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg }]}
            >
              <Text style={[styles.label, a.danger && styles.danger]}>{a.label}</Text>
              {a.hint ? <Text style={styles.hint}>{a.hint}</Text> : null}
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.row, styles.cancel, pressed && { backgroundColor: colors.bg }]}>
            <Text style={styles.label}>Отмена</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingTop: space.s8 },
  handle: { width: sheetHandle.width, height: sheetHandle.height, borderRadius: radius.tiny, backgroundColor: colors.handle, alignSelf: 'center', marginBottom: space.s8 },
  title: { fontSize: font.small, color: colors.secondary, paddingHorizontal: space.s20, paddingBottom: space.s8 },
  row: { minHeight: touch.big, justifyContent: 'center', paddingHorizontal: space.s20, borderTopWidth: stroke.hair, borderTopColor: colors.border },
  cancel: { marginTop: space.s4 },
  label: { fontSize: font.text, fontWeight: '600' },
  danger: { color: colors.danger },
  hint: { fontSize: font.caption, color: colors.secondary },
});
