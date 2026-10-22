import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../../components/Text';
import { BigButton } from '../../../../components/BigButton';
import { PendingWorkCard } from '../../../../components/PendingWorkCard';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { WorksMoney } from '../../../../components/WorksMoney';
import { formatDate } from '../../../../lib/dates';
import { pendingQueue } from '../../../../lib/manager';
import { requestCard, requestLabel } from '../../../../lib/requests';
import { TourTarget } from '../../../../lib/tour';
import { useFocusQuery } from '../../../../lib/useQuery';
import { fetchEntryPhotos, type RemotePhoto } from '../../../../lib/workPhotos';
import { colors, font, space } from '../../../../theme';

/**
 * Оценка заявки: сверху работы без цены (нажатие — экран оценки работы), ниже — оценённые с ценой и итог.
 * Всё оценено и заявка на проверке — «Проверить заявку» (Принять / Вернуть).
 */
export default function PendingRequestScreen() {
  const { number } = useLocalSearchParams<{ number: string }>();
  const query = useFocusQuery(async () => {
    const [card, queue] = await Promise.all([requestCard({ number }), pendingQueue()]);
    const rows = queue.filter((r) => r.request_number === number);
    const photos = rows.length
      ? await fetchEntryPhotos(rows.map((r) => r.entry_id)).catch((): Record<number, RemotePhoto[]> => ({}))
      : {};
    return { card, rows, photos };
  }, { key: `pending:req:${number}`, persist: false });
  const { data: q, error, loading, reload } = query;

  if (!q) return <Screen><StateView loading={loading} error={error} onRetry={reload} /></Screen>;
  const r = q.card;
  // оценённые и отклонённые — ниже, с ценами и итогом
  const done = r ? r.works.filter((w) => w.status !== 'pending') : [];
  const footer = r ? (
    !q.rows.length && r.status === 'review' ? (
      <BigButton title="Проверить заявку" size="big" onPress={() => router.replace({ pathname: '/review/[id]', params: { id: String(r.id) } })} />
    ) : (
      <BigButton title="Открыть заявку" variant="secondary" onPress={() => router.push({ pathname: '/requests/[id]', params: { id: String(r.id) } })} />
    )
  ) : undefined;

  return (
    <Screen status={query} footer={footer}>
      <Text style={styles.number}>{requestLabel(number)}</Text>
      {r?.operation ? <Text style={styles.op}>{r.operation}</Text> : null}
      {r?.responsible_name ? (
        <Text style={styles.meta}>
          Взял {r.responsible_name}
          {r.members.length ? ` · напарники: ${r.members.map((m) => m.name).join(', ')}` : ''}
          {r.taken_at ? ` · с ${formatDate(r.taken_at.slice(0, 10))}` : ''}
        </Text>
      ) : null}

      <Text style={styles.section}>Ждут оценки: {q.rows.length}</Text>
      {!q.rows.length ? <Text style={styles.ok}>Все работы по заявке оценены.</Text> : null}
      {q.rows.map((row, i) => (
        <TourTarget key={row.entry_id} id={i === 0 ? 'pgroup.first' : `pgroup.${row.entry_id}`}>
          <PendingWorkCard row={row} photos={q.photos[row.entry_id]} />
        </TourTarget>
      ))}

      {r && done.length ? (
        <View style={styles.done}>
          <WorksMoney requestId={r.id} works={done} title="Оценено" unpricedHint={false} />
        </View>
      ) : null}
      {!r ? <Text style={styles.meta}>Заявка не загрузилась — потяните вниз, чтобы обновить.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: { fontSize: font.title, fontWeight: '800' },
  op: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.muted },
  section: { fontSize: font.body, fontWeight: '700', marginTop: space.s8 },
  ok: { fontSize: font.body, fontWeight: '700', color: colors.success },
  done: { marginTop: space.s8 },
});
