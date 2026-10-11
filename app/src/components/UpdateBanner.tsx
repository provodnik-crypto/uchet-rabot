import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApkRelease, useAppUpdate } from '../lib/appUpdate';
import { colors, font } from '../theme';

/**
 * Полоса сверху: либо вышла новая сборка APK (её надо установить, обновления на старую не придут),
 * либо новая версия уже скачана — одно касание, и приложение перезапускается.
 */
export function UpdateBanner() {
  const { ready, apply } = useAppUpdate();
  const apkUrl = useApkRelease();
  const insets = useSafeAreaInsets();
  if (apkUrl) {
    return (
      <Pressable onPress={() => Linking.openURL(apkUrl)} style={[styles.bar, { paddingTop: insets.top + 8 }]} accessibilityRole="link">
        <Text style={styles.text}>Вышла новая сборка приложения. Установите её поверх старой — данные сохранятся</Text>
        <Text style={styles.btn}>Скачать</Text>
      </Pressable>
    );
  }
  if (!ready) return null;
  return (
    <Pressable onPress={apply} style={[styles.bar, { paddingTop: insets.top + 8 }]} accessibilityRole="button">
      <Text style={styles.text}>Есть новая версия приложения</Text>
      <Text style={styles.btn}>Обновить</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.black, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { color: '#FFFFFF', fontSize: font.small, fontWeight: '600', flex: 1 },
  btn: { backgroundColor: colors.brand, color: colors.black, fontWeight: '700', fontSize: font.small + 1, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, overflow: 'hidden' },
});
