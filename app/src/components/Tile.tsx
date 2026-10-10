import { StyleSheet, Text, View } from 'react-native';
import { colors, font, touch } from '../theme';
import { Card } from './Card';

type Props = { title: string; subtitle?: string; badge?: number | null; onPress?: () => void; soon?: boolean };

/** Плитка раздела на главном экране. */
export function Tile({ title, subtitle, badge, onPress, soon }: Props) {
  return (
    <Card onPress={soon ? undefined : onPress} style={[styles.tile, soon && styles.soon]}>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {soon ? <Text style={styles.subtitle}>Появится на следующих этапах</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { minHeight: touch.big, justifyContent: 'center', gap: 4 },
  soon: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: font.body, fontWeight: '700' },
  subtitle: { fontSize: font.small, color: colors.muted },
  badge: { minWidth: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  badgeText: { fontWeight: '800', fontSize: font.body },
});
