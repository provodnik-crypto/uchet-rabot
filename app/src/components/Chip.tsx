import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, font, radius, touch } from '../theme';

type Props = { label: string; selected?: boolean; onPress: () => void; /** Картинка слева, например значок сотрудника. */ left?: ReactNode };

export function Chip({ label, selected, onPress, left }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, left ? styles.withLeft : null, selected && styles.selected, pressed && { opacity: 0.7 }]}
    >
      {left}
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touch.small,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  withLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4 },
  selected: { backgroundColor: colors.brand, borderColor: colors.brand },
  text: { fontSize: font.small + 1 },
  selectedText: { fontWeight: '700' },
});
