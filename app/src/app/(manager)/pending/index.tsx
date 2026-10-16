import { router } from 'expo-router';
import { requestLabel } from '../../../lib/requests';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../components/Card';
import { PhotoStrip } from '../../../components/PhotoStrip';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { pendingQueue } from '../../../lib/manager';
import { formatKop } from '../../../lib/money';
import { formatQuantity } from '../../../lib/shift';
import { TourTarget } from '../../../lib/tour';
import { useFocusQuery } from '../../../lib/useQuery';
import { fetchEntryPhotos, type RemotePhoto } from '../../../lib/workPhotos';
import { colors, font } from '../../../theme';

export default function PendingScreen() {
  const { data: q, error, loading, reload } = useFocusQuery(async () => {
    const rows = await pendingQueue();
    const photos = await fetchEntryPhotos(rows.map((r) => r.entry_id)).catch((): Record<number, RemotePhoto[]> => ({}));
    return { rows, photos };
  });
  const data = q?.rows;
  return (
    <Screen>
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data && !data.length ? <Text style={styles.empty}>Все работы оценены.</Text> : null}
      {data?.length ? <Text style={styles.count}>Ждут оценки: {data.length}</Text> : null}
      {data?.map((r, i) => (
        <TourTarget key={r.entry_id} id={i === 0 ? 'pending.first' : `pending.${r.entry_id}`}>
        <Card key={r.entry_id} style={styles.card} onPress={() => router.push({ pathname: '/pending/[id]', params: { id: String(r.entry_id) } })}>
          <View style={styles.top}>
            <View style={styles.flex}>
              <Text style={styles.name}>{r.custom_name}</Text>
              <Text style={styles.qty}>
                {formatQuantity(r.quantity)} {r.unit_code}
              </Text>
            </View>
            <PhotoStrip photos={q?.photos[r.entry_id]} size="small" />
          </View>
          <Text style={styles.meta}>
            {formatDate(r.work_date)} · {r.request_number ? requestLabel(r.request_number) : 'без заявки'} · {r.performer_names}
          </Text>
          {r.note ? <Text style={styles.meta}>Примечание: {r.note}</Text> : null}
          {r.hint_price_kop ? (
            <Text style={styles.hint}>
              Раньше оценивали: {formatKop(r.hint_price_kop)} за {r.unit_code}
            </Text>
          ) : null}
        </Card>
        </TourTarget>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, fontSize: font.body, textAlign: 'center', marginTop: 24 },
  count: { fontSize: font.body, fontWeight: '700' },
  card: { gap: 4 },
  top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  flex: { flex: 1 },
  name: { fontSize: font.body, fontWeight: '700' },
  qty: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  hint: { fontSize: font.small, fontWeight: '700', color: colors.success },
});
