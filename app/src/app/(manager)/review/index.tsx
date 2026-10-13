import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Card } from '../../../components/Card';
import { RequestBadges } from '../../../components/RequestBadges';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { listRequests } from '../../../lib/manager';
import { formatMinutes, formatPlan } from '../../../lib/requestTime';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

/** Заявки, которые мастера отправили на проверку. */
export default function ReviewQueueScreen() {
  const { data: rows, error, loading, reload } = useFocusQuery(() => listRequests('', 'all', { lifecycle: 'review' }));
  return (
    <Screen>
      {!rows ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {rows && !rows.length ? <Text style={styles.meta}>Заявок на проверке нет.</Text> : null}
      {rows?.map((r) => {
        const over = r.plan_minutes != null && (r.spent_minutes ?? 0) > r.plan_minutes;
        return (
          <Card key={r.id} style={styles.card} onPress={() => router.push({ pathname: '/review/[id]', params: { id: String(r.id) } })}>
            <RequestBadges status={r.status} priority={r.priority} unread={r.unread} />
            <Text style={styles.number}>{r.number}</Text>
            {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}
            <Text style={[styles.meta, over && styles.over]}>
              {r.responsible_name} · работ: {r.entries} · {formatMinutes(r.spent_minutes ?? 0)}
              {r.plan_minutes != null ? ` из ~${formatPlan(r.plan_minutes)}` : ''}
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 3 },
  number: { fontSize: font.body, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.secondary },
  over: { color: colors.danger, fontWeight: '700' },
});
