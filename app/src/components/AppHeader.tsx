import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, opacity, space, touch } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Кнопка-значок 48×48 (назад, «⋯», профиль). */
export function IconButton({ icon, label, onPress, round }: { icon: IconName; label: string; onPress: () => void; round?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={round ? 2 : 0}
      style={({ pressed }) => [round ? styles.round : styles.icon, pressed && { opacity: opacity.pressed }]}
    >
      <Icon name={icon} />
    </Pressable>
  );
}

/**
 * Жёлтая шапка экрана. С title — строка «назад · заголовок · справа»; с children — своё содержимое
 * (главная: приветствие; «Заявки»: заголовок и поиск).
 */
export function AppHeader({
  title,
  subtitle,
  back,
  right,
  large,
  children,
}: {
  title?: string;
  subtitle?: string;
  /** Показать «назад» (по умолчанию — router.back). */
  back?: boolean | (() => void);
  right?: ReactNode;
  /** Крупный заголовок вкладки (24), под ним — children (например, поиск). */
  large?: boolean;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const goBack = typeof back === 'function' ? back : () => (router.canGoBack() ? router.back() : router.replace('/'));
  if (children || large)
    return (
      <View style={[styles.wrap, styles.big, { paddingTop: insets.top + space.s20 }]}>
        {large ? <Text style={styles.h1}>{title}</Text> : null}
        {children}
      </View>
    );
  return (
    <View style={[styles.wrap, styles.row, { paddingTop: insets.top + space.s8 }]}>
      {back ? <IconButton icon="back" label="Назад" onPress={goBack} /> : <View style={styles.gap} />}
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1} selectable>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.brand },
  big: { paddingHorizontal: space.s20, paddingBottom: space.s16, gap: space.s12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s4, paddingHorizontal: space.s8, paddingBottom: space.s8 },
  flex: { flex: 1 },
  gap: { width: space.s8 },
  title: { fontSize: font.title, fontWeight: '700' },
  h1: { fontSize: font.h1, fontWeight: '700' },
  subtitle: { fontSize: font.caption },
  icon: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  round: {
    width: touch.icon,
    height: touch.icon,
    borderRadius: touch.icon / 2,
    backgroundColor: colors.onBrandGlass,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
