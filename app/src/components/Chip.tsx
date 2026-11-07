import { type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, font, opacity, radius, space, stroke, touch } from '../theme';

type Props = { label: string; selected?: boolean; onPress: () => void; /** Картинка слева, например значок сотрудника. */ left?: ReactNode };

export function Chip({ label, selected, onPress, left }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={space.s6}
      style={({ pressed }) => [styles.chip, left ? styles.withLeft : null, selected && styles.selected, pressed && { opacity: opacity.pressed }]}
    >
      {left}
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touch.small,
    paddingHorizontal: space.s14,
    borderRadius: radius.chip,
    borderWidth: stroke.hair,
    borderColor: colors.border,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  withLeft: { flexDirection: 'row', alignItems: 'center', gap: space.s6, paddingLeft: space.s4 },
  selected: { backgroundColor: colors.brand, borderColor: colors.brand },
  text: { fontSize: font.small },
  selectedText: { fontWeight: '700' },
});
