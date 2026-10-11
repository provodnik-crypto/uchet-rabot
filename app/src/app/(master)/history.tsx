import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../components/BigButton';
import { EntryCard } from '../../components/EntryCard';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { confirm } from '../../lib/confirm';
import { formatDate } from '../../lib/dates';
import { useDraft } from '../../lib/draft';
import { formatQuantity, myEntries, statusLabel, type MyEntry } from '../../lib/shift';
import { goToShiftList } from '../../lib/shiftNav';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font } from '../../theme';

const tone = { priced: 'ok', pending: 'wait', rejected: 'bad' } as const;

export default function HistoryScreen() {
  const { data, error, loading, reload } = useFocusQuery(() => myEntries(60));
  const { draft, startEdit } = useDraft();

  const shifts: { id: number; rows: MyEntry[] }[] = [];
  for (const r of data ?? []) {
    const s = shifts.find((x) => x.id === r.shift_id);
    if (s) s.rows.push(r);
    else shifts.push({ id: r.shift_id, rows: [r] });
  }

  async function edit(rows: MyEntry[]) {
    if (draft?.entries.length && !(await confirm('Заменить черновик?', 'Неотправленный черновик будет удалён.', 'Заменить'))) return;
    startEdit(rows);
    goToShiftList();
  }

  return (
    <Screen>
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data && !data.length ? <Text style={styles.empty}>За последние 60 дней работ нет.</Text> : null}
      {shifts.map((s) => (
        <View key={s.id} style={styles.shift}>
          <Text style={styles.date}>{formatDate(s.rows[0].work_date)}</Text>
          {s.rows.map((r) => (
            <EntryCard
              key={r.entry_id}
              name={r.name}
              category={`${r.request_number ? `Заявка ${r.request_number}` : 'Без заявки'}${r.is_custom ? ' · вне прайса' : ''}`}
              isCustom={false}
              quantity={formatQuantity(r.quantity)}
              unitCode={r.unit_code}
              department={r.department_name}
              performers={r.performer_names}
              note={r.note}
              status={{ label: statusLabel[r.status], tone: tone[r.status] }}
              comment={r.status === 'rejected' ? r.reject_comment : null}
            />
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
