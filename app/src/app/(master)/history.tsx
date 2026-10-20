import { router } from 'expo-router';
import { requestLabel } from '../../lib/requests';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../components/BigButton';
import { EntryCard } from '../../components/EntryCard';
import { PhotoBadge } from '../../components/PhotoStrip';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { confirm } from '../../lib/confirm';
import { formatDate } from '../../lib/dates';
import { useDraft } from '../../lib/draft';
import { formatQuantity, myEntries, myShiftRequests, statusLabel, type MyEntry } from '../../lib/shift';
import { goToShiftList } from '../../lib/shiftNav';
import { useFocusQuery } from '../../lib/useQuery';
import { fetchEntryPhotos, type RemotePhoto } from '../../lib/workPhotos';
import { colors, font } from '../../theme';

const tone = { priced: 'ok', pending: 'wait', rejected: 'bad', awaiting: 'wait' } as const;

export default function HistoryScreen() {
  // фото — временные ссылки, поэтому на телефоне между запусками не храним
  const query = useFocusQuery(
    async () => {
      const rows = await myEntries(60);
      const photos = await fetchEntryPhotos(rows.map((r) => r.entry_id)).catch((): Record<number, RemotePhoto[]> => ({}));
      return { rows, photos };
    },
    { key: 'history', persist: false },
  );
  const { data, error, loading, reload } = query;
  const { draft, startEdit } = useDraft();

  const shifts: { id: number; rows: MyEntry[] }[] = [];
  for (const r of data?.rows ?? []) {
    const s = shifts.find((x) => x.id === r.shift_id);
    if (s) s.rows.push(r);
    else shifts.push({ id: r.shift_id, rows: [r] });
  }

  async function edit(rows: MyEntry[]) {
    if (draft?.entries.length && !(await confirm('Заменить черновик?', 'Неотправленный черновик будет удалён.', 'Заменить'))) return;
    // время и статусы заявок этой смены; без связи — правка без них (время придётся указать заново)
    const times = rows[0]?.client_uuid ? await myShiftRequests(rows[0].client_uuid).catch(() => []) : [];
    startEdit(
      rows,
      data?.photos,
      times.map((t) => ({ number: t.request_number, minutes: t.minutes, status: t.status ?? 'done' })),
    );
    goToShiftList();
  }

  return (
    <Screen status={query}>
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data && !data.rows.length ? <Text style={styles.empty}>За последние 60 дней работ нет.</Text> : null}
      {shifts.map((s) => (
        <View key={s.id} style={styles.shift}>
          <Text style={styles.date}>{formatDate(s.rows[0].work_date)}</Text>
          {s.rows.map((r) => (
            <Fragment key={r.entry_id}>
              <EntryCard
                name={r.name}
                category={`${r.request_number ? `Заявка ${requestLabel(r.request_number)}` : 'Без заявки'}${r.is_custom ? ' · вне прайса' : ''}`}
                isCustom={false}
                quantity={formatQuantity(r.quantity)}
                unitCode={r.unit_code}
                department={r.department_name}
                performers={r.performer_names}
                note={r.note}
                status={{ label: statusLabel[r.status], tone: tone[r.status] }}
                comment={r.status === 'rejected' ? r.reject_comment : null}
                extra={<PhotoBadge photos={data?.photos[r.entry_id]} />}
              />
              {r.status === 'rejected' && r.client_uuid ? (
                <BigButton title="Исправить и отправить снова" onPress={() => router.push({ pathname: '/fix', params: { id: String(r.entry_id) } })} />
              ) : null}
            </Fragment>
          ))}
          {s.rows[0].can_edit ? <BigButton title="Изменить смену" variant="secondary" onPress={() => edit(s.rows)} /> : null}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shift: { gap: 10 },
  date: { fontSize: font.title, fontWeight: '800', marginTop: 8 },
  empty: { color: colors.muted, fontSize: font.body, textAlign: 'center' },
});
