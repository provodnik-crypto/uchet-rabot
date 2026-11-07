import { Linking, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApkRelease } from '../lib/appUpdate';
import { colors, font, radius, space } from '../theme';

/**
 * Полоса сверху — только когда вышла новая сборка APK (новая иконка, разрешения или нативные модули):
 * её надо установить, обновления на старую не придут. Обычные обновления ставятся сами (lib/appUpdate.ts).
 */
export function UpdateBanner() {
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
  return null;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.black, paddingHorizontal: space.s16, paddingBottom: space.s8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s12 },
  text: { color: colors.white, fontSize: font.small, fontWeight: '600', flex: 1 },
  btn: { backgroundColor: colors.brand, color: colors.black, fontWeight: '700', fontSize: font.small, paddingHorizontal: space.s14, paddingVertical: space.s8, borderRadius: radius.small, overflow: 'hidden' },
});
