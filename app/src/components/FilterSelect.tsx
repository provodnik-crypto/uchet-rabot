import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, touch } from '../theme';
import { Icon } from './Icon';

export type FilterOption<T> = { value: T; label: string; left?: ReactNode };

type Props<T> = {
  /** Название фильтра, видно, пока ничего не выбрано. */
  label: string;
  /** Подпись пункта «все» в списке, например «Все отделы». */
  allLabel: string;
  value: T | null;
  options: FilterOption<T>[];
  onChange: (value: T | null) => void;
};

/** Компактный фильтр: кнопка-«таблетка», выбор в шторке снизу, сброс крестиком. */
export function FilterSelect<T extends string | number>({ label, allLabel, value, options, onChange }: Props<T>) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const current = value == null ? null : options.find((o) => o.value === value);
  const pick = (v: T | null) => {
    setOpen(false);
    onChange(v);
  };

  return (
    <>
      {current ? (
        <View style={[styles.pill, styles.active]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current.label}`} onPress={() => setOpen(true)} hitSlop={{ top: 6, bottom: 6, left: 6 }} style={styles.activeMain}>
            <Text style={styles.activeText} numberOfLines={1}>
              {current.label}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Сбросить: ${label}`} onPress={() => onChange(null)} hitSlop={{ top: 6, bottom: 6, right: 6 }} style={styles.clear}>
            <Icon name="close" size={14} strokeWidth={2.8} />
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} hitSlop={6} style={({ pressed }) => [styles.pill, styles.idle, pressed && { opacity: 0.7 }]}>
          <Text style={styles.idleText}>{label}</Text>
          <Icon name="chevronDown" size={14} color={colors.secondary} strokeWidth={2.4} />
        </Pressable>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Закрыть" onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setOpen(false)} style={styles.close}>
                <Icon name="close" size={18} />
              </Pressable>
            </View>
            <ScrollView>
              <Row label={allLabel} checked={value == null} onPress={() => pick(null)} />
              {options.map((o) => (
                <Row key={String(o.value)} label={o.label} left={o.left} checked={o.value === value} onPress={() => pick(o.value)} />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Row({ label, left, checked, onPress }: { label: string; left?: ReactNode; checked: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: checked }} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg }]}>
      {left}
      <Text style={[styles.rowText, checked && styles.rowChecked]}>{label}</Text>
      {checked ? <Icon name="check" size={20} strokeWidth={2.6} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { height: touch.small, borderRadius: radius.chip, flexDirection: 'row', alignItems: 'center' },
  idle: { gap: 6, paddingLeft: 14, paddingRight: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  idleText: { fontSize: font.small + 1 },
  active: { backgroundColor: colors.brand, maxWidth: 220 },
  activeMain: { height: touch.small, justifyContent: 'center', paddingLeft: 14, paddingRight: 4, flexShrink: 1 },
  activeText: { fontSize: font.small + 1, fontWeight: '700' },
  clear: { width: 32, height: touch.small, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '75%', backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D0D0D0', alignSelf: 'center', marginBottom: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4 },
  sheetTitle: { fontSize: font.title, fontWeight: '700' },
  close: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.min, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.bg },
  rowText: { flex: 1, fontSize: font.body },
  rowChecked: { fontWeight: '700' },
});
