import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, touch } from '../theme';

type Props<T extends string> = { options: { value: T; label: string; a11y?: string }[]; value: T; onChange: (value: T) => void };

/** Переключатель в одну строку: выбранный вариант — жёлтый. */
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === o.value }}
          accessibilityLabel={o.a11y ?? o.label}
          onPress={() => onChange(o.value)}
          style={[styles.item, value === o.value && styles.on]}
        >
          <Text style={[styles.text, value === o.value && styles.textOn]} numberOfLines={1}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 2, padding: 3, backgroundColor: colors.card, borderRadius: radius.control },
  item: { flex: 1, height: touch.small + 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  on: { backgroundColor: colors.brand },
  text: { fontSize: font.small },
  textOn: { fontWeight: '700' },
});
