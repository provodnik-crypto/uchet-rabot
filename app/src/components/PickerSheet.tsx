import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, touch } from '../theme';
import { Icon } from './Icon';

export type PickerOption<T> = { value: T; label: string; left?: ReactNode };

type Props<T> = {
  visible: boolean;
  title: string;
  options: PickerOption<T>[];
  /** Выбранные значения (галочки). */
  selected: T[];
  onPick: (value: T) => void;
  onClose: () => void;
  /** Кнопка внизу, например «Готово» для выбора нескольких. */
  footer?: ReactNode;
};

/** Шторка снизу со списком вариантов. */
export function PickerSheet<T>({ visible, title, options, selected, onPick, onClose, footer }: Props<T>) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Закрыть" onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} style={styles.close}>
              <Icon name="close" size={18} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {options.map((o, i) => {
              const checked = selected.includes(o.value);
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityState={{ selected: checked }}
                  onPress={() => onPick(o.value)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg }]}
                >
                  {o.left}
                  <Text style={[styles.rowText, checked && styles.rowChecked]}>{o.label}</Text>
                  {checked ? <Icon name="check" size={20} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '80%', backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D0D0D0', alignSelf: 'center', marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4 },
  title: { fontSize: font.title, fontWeight: '700' },
  close: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.min, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.bg },
  rowText: { flex: 1, fontSize: font.body },
  rowChecked: { fontWeight: '700' },
  footer: { paddingHorizontal: 16, paddingTop: 12 },
});
