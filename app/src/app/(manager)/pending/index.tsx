import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Card } from '../../../components/Card';
import { PendingWorkCard } from '../../../components/PendingWorkCard';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { pendingQueue, type PendingRow } from '../../../lib/manager';
import { requestCard, requestLabel } from '../../../lib/requests';
import { TourTarget } from '../../../lib/tour';
import { useFocusQuery } from '../../../lib/useQuery';
import { fetchEntryPhotos, type RemotePhoto } from '../../../lib/workPhotos';
import { colors, font, space } from '../../../theme';

type Group = { number: string; title: string | null; rows: PendingRow[]; total: number | null };

const worksWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? 'работа' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'работы' : 'работ';
const requestsWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? 'заявке' : 'заявках';

/** «На оценке»: одна плашка на заявку (сколько работ ждут цены), нажатие — все работы заявки. */
export default function PendingScreen() {
  const query = useFocusQuery(async () => {
    const rows = await pendingQueue();
    const byNumber = new Map<string, PendingRow[]>();
    const loose: PendingRow[] = [];
    for (const r of rows) {
      if (!r.request_number) loose.push(r);
      else byNumber.set(r.request_number, [...(byNumber.get(r.request_number) ?? []), r]);
    }
    // название заявки и сколько в ней всего работ; не загрузилось — плашка всё равно есть
    const groups: Group[] = await Promise.all(
      [...byNumber].map(async ([number, list]) => {
        const card = await requestCard({ number }).catch(() => null);
        return { number, rows: list, title: card?.operation ?? card?.subject ?? null, total: card?.works.filter((w) => w.status !== 'rejected').length ?? null };
      }),
    );
    // больше неоценённых — выше; при равенстве — что отправили раньше
    const first = (g: Group) => g.rows.reduce((m, r) => (r.submitted_at < m ? r.submitted_at : m), g.rows[0].submitted_at);
    groups.sort((a, b) => b.rows.length - a.rows.length || first(a).localeCompare(first(b)));
    const photos = loose.length
      ? await fetchEntryPhotos(loose.map((r) => r.entry_id)).catch((): Record<number, RemotePhoto[]> => ({}))
      : {};
    return { count: rows.length, groups, loose, photos };
  }, { key: 'pending:groups' });
  const { data: q, error, loading, reload } = query;
  return (
    <Screen status={query}>
      {!q ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {q && !q.count ? <Text style={styles.empty}>Все работы оценены.</Text> : null}
      {q?.count ? (
        <Text style={styles.count}>
          Ждут оценки: {q.count} {worksWord(q.count)}
          {q.groups.length ? ` в ${q.groups.length} ${requestsWord(q.groups.length)}` : ''}
        </Text>
      ) : null}
      {q?.groups.map((g, i) => {
        const names = g.rows.map((r) => r.custom_name);
        const performers = [...new Set(g.rows.flatMap((r) => r.performer_names.split(', ').filter(Boolean)))].join(', ');
        const dates = [...new Set(g.rows.map((r) => r.work_date))].sort();
        return (
          <TourTarget key={g.number} id={i === 0 ? 'pending.first' : `pending.req.${g.number}`}>
            <Card style={styles.card} onPress={() => router.push({ pathname: '/pending/req/[number]', params: { number: g.number } })}>
              <Text style={styles.number}>{requestLabel(g.number)}</Text>
              {g.title ? <Text style={styles.title} numberOfLines={2}>{g.title}</Text> : null}
              <Text style={styles.waiting}>
                Ждут оценки: {g.rows.length} {worksWord(g.rows.length)}
                {g.total != null && g.total > g.rows.length ? ` · всего в заявке ${g.total}` : ''}
              </Text>
              <Text style={styles.meta} numberOfLines={2}>
                {names.slice(0, 2).join(', ')}
                {names.length > 2 ? ` и ещё ${names.length - 2}` : ''}
              </Text>
              <Text style={styles.meta}>
                {formatDate(dates[0])}
                {dates.length > 1 ? `–${formatDate(dates[dates.length - 1])}` : ''}
                {performers ? ` · ${performers}` : ''}
              </Text>
            </Card>
          </TourTarget>
        );
      })}
      {q?.loose.length ? (
        <View style={styles.loose}>
          <Text style={styles.count}>Без заявки</Text>
          {q.loose.map((r, i) => (
            <TourTarget key={r.entry_id} id={!q.groups.length && i === 0 ? 'pending.first' : `pending.${r.entry_id}`}>
              <PendingWorkCard row={r} photos={q.photos[r.entry_id]} />
            </TourTarget>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, fontSize: font.body, textAlign: 'center', marginTop: space.s24 },
  count: { fontSize: font.body, fontWeight: '700' },
  card: { gap: space.s4 },
  number: { fontSize: font.title, fontWeight: '800' },
  title: { fontSize: font.body, fontWeight: '700' },
  waiting: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.muted },
  loose: { gap: space.s12 },
});
