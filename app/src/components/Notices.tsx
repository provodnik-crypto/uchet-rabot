import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, font, iconSize, opacity, radius, size, space, stroke } from '../theme';
import { Icon } from './Icon';

export type Notice = { key: string; tone: 'red' | 'blue' | 'orange'; title: string; text?: string | null; onPress: () => void };

/** Цвет точки: красная — срочное и отказы, тёмно-жёлтая — ждут решения, чёрная — сообщения. */
const toneColor = { red: colors.danger, blue: colors.black, orange: colors.brandDark };

/** Уведомления на главной — лента с цветными точками (как «Что нового» у мастера); каждая строка ведёт к делу. */
export function Notices({ items }: { items: Notice[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.box}>
      {items.map((n, i) => (
        <Pressable
          key={n.key}
          accessibilityRole="button"
          onPress={n.onPress}
          style={({ pressed }) => [styles.row, i > 0 && styles.line, pressed && { opacity: opacity.pressed }]}
        >
          <View style={[styles.dot, { backgroundColor: toneColor[n.tone] }]} />
          <View style={styles.flex}>
            <Text style={styles.title}>{n.title}</Text>
            {n.text ? (
              <Text style={styles.text} numberOfLines={2}>
                {n.text}
              </Text>
            ) : null}
          </View>
          <Icon name="chevronRight" size={iconSize.small} color={colors.secondary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: space.s18, paddingVertical: space.s4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s12, paddingVertical: space.s12 },
  line: { borderTopWidth: stroke.hair, borderTopColor: colors.border },
  dot: { width: size.dot, height: size.dot, borderRadius: radius.round, marginTop: space.s6 },
  flex: { flex: 1, gap: space.s2 },
  title: { fontSize: font.list, fontWeight: '700' },
  text: { fontSize: font.small, color: colors.secondary },
});
