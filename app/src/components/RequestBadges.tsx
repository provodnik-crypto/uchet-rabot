import { StyleSheet, Text, View } from 'react-native';
import { CONTRACTOR_COLOR, lifecycleLabel, priorityColor, priorityLabel, type LifecycleStatus, type Priority } from '../lib/requests';
import { colors, font, radius } from '../theme';

/** Метки заявки: «Назначено вам», приоритет (цвет + слово), статус, подрядчик. */
export function RequestBadges({
  status,
  priority,
  contractor,
  mine,
  responsibleName,
}: {
  status: LifecycleStatus;
  priority: Priority;
  contractor?: boolean;
  mine?: boolean;
  /** Для «В работе · Имя Ф.» у чужой заявки. */
  responsibleName?: string | null;
}) {
  const showStatus = status !== 'waiting' && !(status === 'contractor');
  return (
    <View style={styles.row}>
      {mine ? <Text style={[styles.badge, styles.mine]}>{status === 'in_work' || status === 'review' ? 'Ваша заявка' : 'Назначено вам'}</Text> : null}
      {priority !== 3 ? (
        <Text style={[styles.badge, { borderColor: priorityColor[priority], color: priorityColor[priority] }, priority === 1 && styles.urgent]}>
          {priority === 1 ? '● ' : ''}
          {priorityLabel[priority]}
        </Text>
      ) : null}
      {contractor || status === 'contractor' ? <Text style={[styles.badge, styles.contractor]}>Подрядчик</Text> : null}
      {showStatus ? (
        <Text style={[styles.badge, styles.status, status === 'review' && styles.review, status === 'accepted' && styles.accepted]}>
          {status === 'in_work' && responsibleName ? `🔒 В работе · ${responsibleName}` : lifecycleLabel[status]}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    fontSize: font.small,
    fontWeight: '800',
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  mine: { backgroundColor: colors.brand, borderColor: colors.brand },
  urgent: { backgroundColor: '#FDECEA' },
  contractor: { borderColor: CONTRACTOR_COLOR, color: CONTRACTOR_COLOR },
  status: { color: colors.secondary, backgroundColor: colors.bg },
  review: { color: '#1565C0', borderColor: '#1565C0' },
  accepted: { color: colors.success, borderColor: colors.success },
});
