import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, touch } from '../theme';
import { Icon } from './Icon';
import { PickerSheet } from './PickerSheet';

export type FilterOption<T> = { value: T; label: string; left?: ReactNode };

type Props<T> = {
  /** Надпись на кнопке, пока ничего не выбрано. */
  label: string;
  /** Заголовок шторки; по умолчанию как надпись. */
  title?: string;
  /** Пункт «все», например «Все отделы». */
  allLabel: string;
  value: T | null;
  options: FilterOption<T>[];
  onChange: (value: T | null) => void;
};

const ALL = '__all__';

/** Компактный фильтр: кнопка-«таблетка», выбор в шторке снизу, сброс крестиком. */
export function FilterSelect<T extends string | number>({ label, title, allLabel, value, options, onChange }: Props<T>) {
  const [open, setOpen] = useState(false);
  const current = value == null ? null : options.find((o) => o.value === value);

  return (
    <>
      {current ? (
        <View style={[styles.pill, styles.active]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${title ?? label}: ${current.label}`} onPress={() => setOpen(true)} hitSlop={{ top: 6, bottom: 6, left: 6 }} style={styles.activeMain}>
            <Text style={styles.activeText} numberOfLines={1}>
              {current.label}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Сбросить: ${title ?? label}`} onPress={() => onChange(null)} hitSlop={{ top: 6, bottom: 6, right: 6 }} style={styles.clear}>
            <Icon name="close" size={14} strokeWidth={2.8} />
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={title ? `${title}: ${label}` : label} onPress={() => setOpen(true)} hitSlop={6} style={({ pressed }) => [styles.pill, styles.idle, pressed && { opacity: 0.7 }]}>
          <Text style={styles.idleText}>{label}</Text>
          <Icon name="chevronDown" size={14} color={colors.secondary} strokeWidth={2.4} />
        </Pressable>
      )}
      <PickerSheet<T | typeof ALL>
        visible={open}
        title={title ?? label}
        options={[{ value: ALL, label: allLabel }, ...options]}
        selected={[value ?? ALL]}
        onPick={(v) => {
          setOpen(false);
          onChange(v === ALL ? null : (v as T));
        }}
        onClose={() => setOpen(false)}
      />
    </>
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
});
