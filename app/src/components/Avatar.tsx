import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

/** Круглое фото сотрудника; без фото — инициалы на жёлтом фоне. */
export function Avatar({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[styles.img, box]} accessibilityLabel={name} />;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={[styles.fallback, box]}>
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.border },
  fallback: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '800', color: colors.black },
});
