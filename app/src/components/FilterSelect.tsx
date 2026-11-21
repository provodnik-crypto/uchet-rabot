import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, font, iconSize, opacity, radius, size, space, stroke, touch } from '../theme';
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
          <Pressable accessibilityRole="button" accessibilityLabel={`${title ?? label}: ${current.label}`} onPress={() => setOpen(true)} hitSlop={{ top: space.s6, bottom: space.s6, left: space.s6 }} style={styles.activeMain}>
            <Text style={styles.activeText} numberOfLines={1}>
              {current.label}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Сбросить: ${title ?? label}`} onPress={() => onChange(null)} hitSlop={{ top: space.s6, bottom: space.s6, right: space.s6 }} style={styles.clear}>
            <Icon name="close" size={iconSize.small} />
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={title ? `${title}: ${label}` : label} onPress={() => setOpen(true)} hitSlop={space.s6} style={({ pressed }) => [styles.pill, styles.idle, pressed && { opacity: opacity.pressed }]}>
          <Text style={styles.idleText}>{label}</Text>
          <Icon name="chevronDown" size={iconSize.small} color={colors.secondary} />
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
  idle: { gap: space.s6, paddingLeft: space.s14, paddingRight: space.s12, backgroundColor: colors.card, borderWidth: stroke.hair, borderColor: colors.border },
  idleText: { fontSize: font.small },
  active: { backgroundColor: colors.brand, maxWidth: size.filterMax },
  activeMain: { height: touch.small, justifyContent: 'center', paddingLeft: space.s14, paddingRight: space.s4, flexShrink: 1 },
  activeText: { fontSize: font.small, fontWeight: '700' },
  clear: { width: touch.tiny, height: touch.small, alignItems: 'center', justifyContent: 'center' },
});
