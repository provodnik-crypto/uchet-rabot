import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppUpdate } from '../lib/appUpdate';
import { colors, font } from '../theme';

/** Полоса сверху, когда новая версия уже скачана: одно касание — и приложение перезапускается. */
export function UpdateBanner() {
  const { ready, apply } = useAppUpdate();
  const insets = useSafeAreaInsets();
  if (!ready) return null;
  return (
    <Pressable onPress={apply} style={[styles.bar, { paddingTop: insets.top + 10 }]} accessibilityRole="button">
      <Text style={styles.text}>Есть новая версия приложения</Text>
      <Text style={styles.btn}>Обновить</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.black, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { color: '#FFFFFF', fontSize: font.small, fontWeight: '600', flex: 1 },
  btn: { backgroundColor: colors.brand, color: colors.black, fontWeight: '800', fontSize: font.body, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, overflow: 'hidden' },
});
