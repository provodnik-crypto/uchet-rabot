import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';

export type Notice = { key: string; tone: 'red' | 'blue' | 'orange'; title: string; text?: string | null; onPress: () => void };

const toneColor = { red: colors.danger, blue: '#1565C0', orange: '#E65100' };

/** Уведомления внутри приложения на главной: каждая строка ведёт к заявке. */
export function Notices({ items }: { items: Notice[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.box}>
      {items.map((n) => (
        <Pressable
          key={n.key}
          accessibilityRole="button"
          onPress={n.onPress}
          style={({ pressed }) => [styles.row, { borderLeftColor: toneColor[n.tone] }, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.flex}>
            <Text style={[styles.title, { color: toneColor[n.tone] }]}>{n.title}</Text>
            {n.text ? (
              <Text style={styles.text} numberOfLines={2}>
                {n.text}
              </Text>
            ) : null}
          </View>
          <Icon name="chevronRight" size={16} color={colors.muted} strokeWidth={2.4} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderLeftWidth: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: font.body, fontWeight: '800' },
  text: { fontSize: font.small, color: colors.secondary },
});
