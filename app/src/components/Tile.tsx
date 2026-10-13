import { StyleSheet, Text, View } from 'react-native';
import { colors, font, touch } from '../theme';
import { Card } from './Card';
import { Icon } from './Icon';

type Props = { title: string; subtitle?: string; badge?: number | null; onPress?: () => void; soon?: boolean };

/** Строка раздела на главном экране: название, пояснение, стрелка. */
export function Tile({ title, subtitle, badge, onPress, soon }: Props) {
  return (
    <Card onPress={soon ? undefined : onPress} style={[styles.tile, soon && styles.soon]}>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {soon ? <Text style={styles.subtitle}>Появится на следующих этапах</Text> : null}
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      {soon ? null : <Icon name="chevronRight" size={16} color={colors.muted} strokeWidth={2.4} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { minHeight: touch.big, flexDirection: 'row', alignItems: 'center', gap: 10 },
  soon: { opacity: 0.5 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: font.body, fontWeight: '700' },
  subtitle: { fontSize: font.small, color: colors.secondary },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { fontWeight: '800', fontSize: font.small },
});
