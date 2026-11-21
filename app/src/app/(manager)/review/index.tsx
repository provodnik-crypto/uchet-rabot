import { router } from 'expo-router';
import { requestLabel } from '../../../lib/requests';
import { StyleSheet } from 'react-native';
import { Text } from '../../../components/Text';
import { Card } from '../../../components/Card';
import { RequestBadges } from '../../../components/RequestBadges';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { listRequests } from '../../../lib/manager';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font, space } from '../../../theme';

/** Заявки, которые мастера отправили на проверку. */
export default function ReviewQueueScreen() {
  const query = useFocusQuery(() => listRequests('', 'all', { lifecycle: 'review' }), { key: 'review' });
  const { data: rows, error, loading, reload } = query;
  return (
    <Screen status={query}>
      {!rows ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {rows && !rows.length ? <Text style={styles.meta}>Заявок на проверке нет.</Text> : null}
      {rows?.map((r) => {
        return (
          <Card key={r.id} style={styles.card} onPress={() => router.push({ pathname: '/review/[id]', params: { id: String(r.id) } })}>
            <RequestBadges status={r.status} priority={r.priority} unread={r.unread} />
            <Text style={styles.number}>{requestLabel(r.number)}</Text>
            {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}
            <Text style={styles.meta}>
              {r.responsible_name} · работ: {r.entries}
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s2 },
  number: { fontSize: font.body, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.secondary },
});
