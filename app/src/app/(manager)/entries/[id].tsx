import { router, useLocalSearchParams } from 'expo-router';
import { requestLabel } from '../../../lib/requests';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import { Avatar } from '../../../components/Avatar';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { PhotoStrip } from '../../../components/PhotoStrip';
import { SelectField } from '../../../components/SelectField';
import { Screen } from '../../../components/Screen';
import { confirm } from '../../../lib/confirm';
import { formatDate, parseDate } from '../../../lib/dates';
import { DateField } from '../../../components/DateField';
import { listDepartments, type Department } from '../../../lib/departments';
import { humanError } from '../../../lib/errors';
import { adminDeleteEntry, adminSetEntryDate, adminUpdateEntry, listPerformers, type AdminEntry } from '../../../lib/manager';
import { formatKop } from '../../../lib/money';
import { useFocusQuery } from '../../../lib/useQuery';
import { useEmployeeIcons } from '../../../lib/employeeIcons';
import { formatQuantity, parseQuantity, statusLabel } from '../../../lib/shift';
import { colors, font, size, space } from '../../../theme';
import { fetchEntryPhotos, type RemotePhoto } from '../../../lib/workPhotos';

export default function AdminEntryScreen() {
  const { data } = useLocalSearchParams<{ id: string; data?: string }>();
  // экран открыли без данных работы (например, восстановление после перезапуска) — назад в журнал
  if (!data) {
    return (
      <Screen>
        <Text>Работа не открыта — вернитесь в журнал работ и выберите её снова.</Text>
        <BigButton title="Назад" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }
  return <AdminEntryForm e={JSON.parse(data) as AdminEntry} />;
}

function AdminEntryForm({ e }: { e: AdminEntry }) {
  const icons = useEmployeeIcons();
  const peopleQ = useFocusQuery(listPerformers, { key: 'performers' });
  const departmentsQ = useFocusQuery(listDepartments, { key: 'departments' });
  const people = peopleQ.data ?? [];
  const departments: Department[] = departmentsQ.data ?? [];
  const [qty, setQty] = useState(formatQuantity(e.quantity));
  const [departmentId, setDepartmentId] = useState(e.department_id);
  const [performers, setPerformers] = useState<number[]>(e.performer_ids ?? []);
  const [note, setNote] = useState(e.note ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [workPhotos, setWorkPhotos] = useState<RemotePhoto[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dateText, setDateText] = useState(formatDate(e.work_date));

  useEffect(() => {
    fetchEntryPhotos([e.entry_id])
      .then((m) => setWorkPhotos(m[e.entry_id] ?? []))
      .catch(() => {});
  }, [e.entry_id]);

  const parsed = parseQuantity(qty, e.integer_only);
  const newTotal = parsed.value && e.unit_price_kop ? Math.max(1, Math.round(parsed.value * e.unit_price_kop)) : null;

  async function save() {
    if (parsed.error) return setMessage(parsed.error);
    if (!performers.length) return setMessage('Выберите исполнителя');
    setBusy('save');
    setMessage(null);
    try {
      await adminUpdateEntry(e.entry_id, parsed.value!, departmentId, note, performers);
      router.back();
    } catch (err) {
      setMessage(humanError(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!(await confirm('Удалить работу?', `${e.name}, ${formatDate(e.work_date)}. Это действие нельзя отменить.`, 'Удалить'))) return;
    setBusy('delete');
    try {
      await adminDeleteEntry(e.entry_id);
      router.back();
    } catch (err) {
      setMessage(humanError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen status={[peopleQ, departmentsQ]} frame>
      <Card style={styles.card}>
        <Text style={styles.meta}>
          {formatDate(e.work_date)} · {e.request_number ? requestLabel(e.request_number) : 'без заявки'} · {statusLabel[e.status]} · внёс {e.author_name}
        </Text>
        <Text style={styles.name}>{e.name}</Text>
        <Text style={styles.meta}>
          Цена за {e.unit_code}: {formatKop(e.unit_price_kop)} (не меняется при правке) · сумма {formatKop(e.total_kop)}
        </Text>
        {e.reject_comment ? <Text style={styles.err}>Комментарий: {e.reject_comment}</Text> : null}
        {workPhotos.length ? <PhotoStrip photos={workPhotos} /> : null}
      </Card>
      <Card style={styles.card}>
        <DateField label="Дата работы" value={dateText} onChange={setDateText} hint="Мастер дату не выбирает — работа датируется днём внесения. Исправить может только руководитель." />
        {dateText !== formatDate(e.work_date) ? (
          <BigButton
            title="Сменить дату"
            variant="secondary"
            loading={busy === 'date'}
            disabled={!!busy}
            onPress={async () => {
              const d = parseDate(dateText);
              if (!d) return setMessage('Дата в виде ДД.ММ.ГГГГ');
              setBusy('date');
              setMessage(null);
              try {
                await adminSetEntryDate(e.entry_id, d);
                router.back();
              } catch (err) {
                setMessage(humanError(err));
              } finally {
                setBusy(null);
              }
            }}
          />
        ) : null}
      </Card>
      <Card style={styles.card}>
        <Field label={`Объём, ${e.unit_code}`} value={qty} onChangeText={setQty} keyboardType={e.integer_only ? 'number-pad' : 'decimal-pad'} error={qty ? parsed.error : null} />
        {newTotal && newTotal !== e.total_kop ? <Text style={styles.total}>Новая сумма: {formatKop(newTotal)}</Text> : null}
        <SelectField
          label="Отдел"
          value={departmentId}
          onChange={setDepartmentId}
          options={departments.filter((d) => d.is_active || d.id === departmentId).map((d) => ({ value: d.id, label: d.name }))}
        />
        <Text style={styles.label}>Исполнители (сумма делится поровну)</Text>
        <View style={styles.chips}>
          {people
            .filter((p) => p.is_active || performers.includes(p.id))
            .map((p) => (
              <Chip
                key={p.id}
                label={p.display_name}
                selected={performers.includes(p.id)}
                left={<Avatar name={p.display_name} icon={icons[p.id]} size={size.check} />}
                onPress={() => setPerformers((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))}
              />
            ))}
        </View>
        <Field label="Примечание" value={note} onChangeText={setNote} multiline />
      </Card>
      {message ? <Text style={styles.err}>{message}</Text> : null}
      <BigButton title="Сохранить" loading={busy === 'save'} disabled={!!busy} onPress={save} />
      <BigButton title="Удалить работу" variant="danger" loading={busy === 'delete'} disabled={!!busy} onPress={remove} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s10 },
  name: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  total: { fontSize: font.body, fontWeight: '700' },
  err: { color: colors.danger, fontSize: font.body },
});
