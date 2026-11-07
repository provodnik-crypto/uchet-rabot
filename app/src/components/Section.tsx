import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, letterSpacing, radius, space, stroke } from '../theme';
import { Text } from './Text';

/** Белая карточка на сером: скругление 16, без рамок и теней; сверху — заголовок заглавными. */
export function Section({ title, right, children, style }: { title?: string; right?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, style]}>
      {title || right ? (
        <View style={styles.head}>
          {title ? <Text style={styles.title}>{title.toUpperCase()}</Text> : <View />}
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Строка списка внутри карточки: название слева, жирное количество справа; линия между строками. */
export function Row({ left, right, first }: { left: ReactNode; right?: ReactNode; first?: boolean }) {
  return (
    <View style={[styles.row, !first && styles.rowLine]}>
      <View style={styles.flex}>{left}</View>
      {right}
    </View>
  );
}

export const sectionText = StyleSheet.create({
  /** Заголовок раздела заглавными. */
  title: { fontSize: font.caption, fontWeight: '700', letterSpacing: letterSpacing.caps },
  body: { fontSize: font.body },
  qty: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
});

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: space.s18, paddingVertical: space.s16, gap: space.s8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s8 },
  title: sectionText.title,
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.s12, paddingVertical: space.s10 },
  rowLine: { borderTopWidth: stroke.hair, borderTopColor: colors.border },
  flex: { flex: 1 },
});
