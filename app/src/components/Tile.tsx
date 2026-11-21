import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, font, iconSize, opacity, radius, size, space, touch } from '../theme';
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
      {soon ? null : <Icon name="chevronRight" size={iconSize.small} color={colors.muted} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { minHeight: touch.big, flexDirection: 'row', alignItems: 'center', gap: space.s10 },
  soon: { opacity: opacity.disabled },
  text: { flex: 1, gap: space.s2 },
  title: { fontSize: font.body, fontWeight: '700' },
  subtitle: { fontSize: font.small, color: colors.secondary },
  badge: { minWidth: size.badge, height: size.badge, borderRadius: radius.control, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.s6 },
  badgeText: { fontWeight: '800', fontSize: font.small },
});
