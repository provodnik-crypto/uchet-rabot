import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { formatDate } from '../lib/dates';
import type { PendingRow } from '../lib/manager';
import { formatKop } from '../lib/money';
import { requestLabel } from '../lib/requests';
import { formatQuantity } from '../lib/shift';
import type { RemotePhoto } from '../lib/workPhotos';
import { colors, font, space } from '../theme';
import { Card } from './Card';
import { PhotoStrip } from './PhotoStrip';
import { Text } from './Text';

/** Работа «На оценке»: название, объём, фото, дата и исполнители; нажатие — экран оценки работы. */
export function PendingWorkCard({ row: r, photos, showRequest = false }: { row: PendingRow; photos?: RemotePhoto[]; showRequest?: boolean }) {
  return (
    <Card style={styles.card} onPress={() => router.push({ pathname: '/pending/[id]', params: { id: String(r.entry_id) } })}>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.name}>{r.custom_name}</Text>
          <Text style={styles.qty}>
            {formatQuantity(r.quantity)} {r.unit_code}
          </Text>
        </View>
        <PhotoStrip photos={photos} size="small" />
      </View>
      <Text style={styles.meta}>
        {formatDate(r.work_date)}
        {showRequest ? ` · ${r.request_number ? requestLabel(r.request_number) : 'без заявки'}` : ''} · {r.performer_names}
      </Text>
      {r.note ? <Text style={styles.meta}>Примечание: {r.note}</Text> : null}
      {r.hint_price_kop ? (
        <Text style={styles.hint}>
          Раньше оценивали: {formatKop(r.hint_price_kop)} за {r.unit_code}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s4 },
  top: { flexDirection: 'row', gap: space.s12, alignItems: 'flex-start' },
  flex: { flex: 1 },
  name: { fontSize: font.body, fontWeight: '700' },
  qty: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  hint: { fontSize: font.small, fontWeight: '700', color: colors.success },
});
