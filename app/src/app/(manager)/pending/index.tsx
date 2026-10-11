import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { pendingQueue } from '../../../lib/manager';
import { formatKop } from '../../../lib/money';
import { formatQuantity } from '../../../lib/shift';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

export default function PendingScreen() {
  const { data, error, loading, reload } = useFocusQuery(pendingQueue);
  return (
    <Screen>
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data && !data.length ? <Text style={styles.empty}>Все работы оценены.</Text> : null}
      {data?.length ? <Text style={styles.count}>Ждут оценки: {data.length}</Text> : null}
      {data?.map((r) => (
        <Card key={r.entry_id} style={styles.card} onPress={() => router.push({ pathname: '/pending/[id]', params: { id: String(r.entry_id) } })}>
          <Text style={styles.name}>{r.custom_name}</Text>
          <Text style={styles.qty}>
            {formatQuantity(r.quantity)} {r.unit_code}
          </Text>
          <Text style={styles.meta}>
            {formatDate(r.work_date)} · {r.request_number ?? 'без заявки'} · {r.performer_names}
          </Text>
          {r.note ? <Text style={styles.meta}>Примечание: {r.note}</Text> : null}
          {r.hint_price_kop ? (
            <Text style={styles.hint}>
              Раньше оценивали: {formatKop(r.hint_price_kop)} за {r.unit_code}
            </Text>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, fontSize: font.body, textAlign: 'center', marginTop: 24 },
  count: { fontSize: font.body, fontWeight: '700' },
  card: { gap: 4 },
  name: { fontSize: font.body, fontWeight: '700' },
  qty: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  hint: { fontSize: font.small, fontWeight: '700', color: colors.success },
});
