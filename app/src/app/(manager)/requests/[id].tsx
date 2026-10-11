import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { formatDate, parseDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { updateRequest, type RequestRow } from '../../../lib/manager';
import { colors, font } from '../../../theme';

const STATES = ['Новая', 'В работе', 'Выполнена', 'Отменена'];

export default function RequestScreen() {
  const { data } = useLocalSearchParams<{ id: string; data: string }>();
  const r = JSON.parse(data) as RequestRow;
  const [requester, setRequester] = useState(r.requester ?? '');
  const [registered, setRegistered] = useState(r.registered_at ? formatDate(r.registered_at) : '');
  const [subject, setSubject] = useState(r.subject ?? '');
  const [state, setState] = useState(r.state ?? '');
  const [note, setNote] = useState(r.note ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    const date = registered.trim() ? parseDate(registered) : null;
    if (registered.trim() && !date) return setMessage('Дата регистрации в виде ДД.ММ.ГГГГ');
    setBusy(true);
    setMessage(null);
    try {
      await updateRequest(r.id, {
        requester: requester.trim() || null,
        registered_at: date,
        subject: subject.trim() || null,
        state: state.trim() || null,
        note: note.trim() || null,
      });
      router.back();
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.number}>{r.number}</Text>
      <Text style={styles.meta}>Работ по заявке: {r.entries}</Text>
      <Card style={styles.card}>
        <Field label="Заявитель (конечный потребитель)" value={requester} onChangeText={setRequester} />
        <Field label="Дата регистрации" value={registered} onChangeText={setRegistered} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" />
        <Field label="Тема" value={subject} onChangeText={setSubject} multiline />
        <Text style={styles.label}>Состояние</Text>
        <View style={styles.chips}>
          {STATES.map((s) => (
            <Chip key={s} label={s} selected={state === s} onPress={() => setState(state === s ? '' : s)} />
          ))}
        </View>
        <Field label="Примечание" value={note} onChangeText={setNote} multiline />
      </Card>
      {message ? <Text style={styles.err}>{message}</Text> : null}
      <BigButton title="Сохранить" loading={busy} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  card: { gap: 12 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  err: { color: colors.danger, fontSize: font.body },
});
