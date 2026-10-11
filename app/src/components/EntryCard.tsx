import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';
import { Card } from './Card';

type Props = {
  name: string;
  category?: string | null;
  isCustom: boolean;
  quantity: string;
  unitCode: string;
  department: string;
  performers: string;
  note?: string | null;
  status?: { label: string; tone: 'ok' | 'wait' | 'bad' };
  comment?: string | null;
  onPress?: () => void;
  onRemove?: () => void;
  /** Число фото (для черновика) или свой элемент, например значок с просмотром. */
  photos?: number;
  extra?: ReactNode;
};

/** Карточка одной работы: без цен и сумм. */
export function EntryCard({ name, category, isCustom, quantity, unitCode, department, performers, note, status, comment, onPress, onRemove, photos, extra }: Props) {
  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.cat}>{isCustom ? 'Вне прайса' : category}</Text>
        </View>
        {status ? <Text style={[styles.status, styles[status.tone]]}>{status.label}</Text> : null}
      </View>
      <Text style={styles.qty}>
        {quantity} {unitCode}
      </Text>
      <Text style={styles.meta}>
        {department} · {performers}
      </Text>
      {note ? <Text style={styles.meta}>Примечание: {note}</Text> : null}
      {photos ? <Text style={styles.meta}>📷 Фото: {photos}</Text> : null}
      {extra}
      {comment ? <Text style={styles.comment}>Руководитель: {comment}</Text> : null}
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={styles.remove}>
          <Text style={styles.removeText}>Удалить</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  top: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: font.body, fontWeight: '700' },
  cat: { fontSize: font.small, color: colors.muted },
  qty: { fontSize: font.title, fontWeight: '800', marginTop: 4 },
  meta: { fontSize: font.small, color: colors.muted },
  comment: { fontSize: font.small, color: colors.danger, fontWeight: '600' },
  status: { fontSize: font.small, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.chip, overflow: 'hidden' },
  ok: { backgroundColor: '#E3F1E4', color: colors.success },
  wait: { backgroundColor: '#FFF3C4', color: '#7A5B00' },
  bad: { backgroundColor: '#FBE3E3', color: colors.danger },
  remove: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { color: colors.danger, fontSize: font.body, fontWeight: '700' },
});
