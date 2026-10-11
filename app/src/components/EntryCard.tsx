import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
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
      <View style={styles.row}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.qty}>
          {quantity} {unitCode}
        </Text>
      </View>
      <Text style={styles.meta}>
        {isCustom ? 'Вне прайса' : category}
        {(isCustom || category) ? ' · ' : ''}
        {department}
      </Text>
      <View style={styles.row}>
        <Text style={styles.people} numberOfLines={2}>
          {performers}
          {photos ? <Text style={styles.meta}> · фото: {photos}</Text> : null}
        </Text>
        {status ? (
          <View style={[styles.pill, pill[status.tone]]}>
            <View style={[styles.dot, dot[status.tone]]} />
            <Text style={styles.pillText}>{status.label}</Text>
          </View>
        ) : null}
        {onRemove ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Удалить: ${name}`} onPress={onRemove} hitSlop={10} style={styles.remove}>
            <Text style={styles.removeText}>Удалить</Text>
          </Pressable>
        ) : null}
      </View>
      {note ? <Text style={styles.meta}>Примечание: {note}</Text> : null}
      {extra}
      {comment ? <Text style={styles.comment}>Руководитель: {comment}</Text> : null}
    </Card>
  );
}

const pill = StyleSheet.create({ ok: { backgroundColor: '#E0EDE9' }, wait: { backgroundColor: '#FFF3C4' }, bad: { backgroundColor: '#F7DCD5' } });
const dot = StyleSheet.create({ ok: { backgroundColor: colors.success }, wait: { backgroundColor: '#BE9200' }, bad: { backgroundColor: colors.danger } });

const styles = StyleSheet.create({
  card: { gap: 4, paddingVertical: 10 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'space-between' },
  name: { flex: 1, fontSize: font.body, fontWeight: '600' },
  qty: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
  people: { flex: 1, fontSize: font.small },
  comment: { fontSize: font.small, color: colors.danger, fontWeight: '600' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 8, borderRadius: 11 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: font.small - 1, fontWeight: '600', color: colors.text },
  remove: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
});
