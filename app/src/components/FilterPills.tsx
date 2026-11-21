import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors, font, opacity, radius, space, touch } from '../theme';
import { Text } from './Text';

/** Фильтры-пилюли: выбранный — чёрный с белым жирным текстом. */
export function FilterPills<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            hitSlop={space.s4}
            style={({ pressed }) => [styles.pill, on && styles.on, pressed && { opacity: opacity.pressed }]}
          >
            <Text style={[styles.text, on && styles.textOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.s8 },
  pill: { height: touch.small, paddingHorizontal: space.s16, borderRadius: radius.chip, backgroundColor: colors.card, justifyContent: 'center' },
  on: { backgroundColor: colors.black },
  text: { fontSize: font.list, color: colors.black },
  textOn: { color: colors.white, fontWeight: '700' },
});
