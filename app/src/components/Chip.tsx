import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, font, radius } from '../theme';

type Props = { label: string; selected?: boolean; onPress: () => void; /** Картинка слева, например фото сотрудника. */ left?: ReactNode };

export function Chip({ label, selected, onPress, left }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, left ? styles.withLeft : null, selected && styles.selected, pressed && { opacity: 0.7 }]}
    >
      {left}
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: radius.chip,
    borderWidth: 2,
    borderColor: colors.black,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  withLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6 },
  selected: { backgroundColor: colors.brand, borderColor: colors.brand },
  text: { fontSize: font.body, fontWeight: '600' },
  selectedText: { fontWeight: '800' },
});
