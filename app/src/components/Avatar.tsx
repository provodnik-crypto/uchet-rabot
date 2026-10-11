import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

/** Кружок сотрудника: первые буквы имени на жёлтом фоне. */
export function Avatar({ name, size = 40 }: { name: string; icon?: number | null; size?: number }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  const initials = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={[styles.fallback, box]} accessibilityLabel={name}>
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '800', color: colors.black },
});
