import { useState } from 'react';
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { colors } from '../theme';

/** Круглое фото сотрудника; без фото (или если картинка не открылась) — инициалы на жёлтом фоне. */
export function Avatar({ name, photo, size = 40 }: { name: string; photo?: ImageSourcePropType | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (photo && !failed) {
    return <Image source={photo} style={[styles.img, box]} accessibilityLabel={name} onError={() => setFailed(true)} />;
  }
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
