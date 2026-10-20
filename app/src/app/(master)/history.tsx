import { router } from 'expo-router';
import { requestLabel } from '../../lib/requests';
import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import { BigButton } from '../../components/BigButton';
import { EntryCard } from '../../components/EntryCard';
import { PhotoBadge } from '../../components/PhotoStrip';
import { AppHeader } from '../../components/AppHeader';
import { BottomTabs } from '../../components/BottomTabs';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { formatDate } from '../../lib/dates';
import { formatQuantity, myEntries, statusLabel, type MyEntry } from '../../lib/shift';
import { useFocusQuery } from '../../lib/useQuery';
import { fetchEntryPhotos, type RemotePhoto } from '../../lib/workPhotos';
import { colors, font, space } from '../../theme';

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

  const shifts: { id: number; rows: MyEntry[] }[] = [];
  for (const r of data?.rows ?? []) {
    const s = shifts.find((x) => x.id === r.shift_id);
    if (s) s.rows.push(r);
    else shifts.push({ id: r.shift_id, rows: [r] });
  }


  return (
    <Screen status={query} tabs footer={<BottomTabs />} header={<AppHeader title="История" large />}>
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
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shift: { gap: space.s10 },
  date: { fontSize: font.title, fontWeight: '800', marginTop: space.s8 },
  empty: { color: colors.muted, fontSize: font.body, textAlign: 'center' },
});
