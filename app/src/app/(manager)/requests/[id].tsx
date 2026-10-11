import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { humanError } from '../../../lib/errors';
import { updateRequest, type RequestRow } from '../../../lib/manager';
import { colors, font } from '../../../theme';

export default function RequestScreen() {
  const { data } = useLocalSearchParams<{ id: string; data: string }>();
  const r = JSON.parse(data) as RequestRow;
  const [subject, setSubject] = useState(r.subject ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await updateRequest(r.id, { subject: subject.trim() || null });
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
        <Field
          label="Тема"
          value={subject}
          onChangeText={setSubject}
          multiline
          hint="Что нужно сделать. Без имён, фамилий и телефонов."
        />
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
  err: { color: colors.danger, fontSize: font.body },
});
