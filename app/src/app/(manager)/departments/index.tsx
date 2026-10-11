import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { addDepartment, isWholeStore, listDepartments } from '../../../lib/departments';
import { humanError } from '../../../lib/errors';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

export default function DepartmentsScreen() {
  const { data, error, loading, reload } = useFocusQuery(listDepartments);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setAddError(null);
    try {
      await addDepartment(name);
      setName('');
      await reload();
    } catch (e) {
      setAddError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card style={styles.card}>
        <Field label="Новый отдел" value={name} onChangeText={setName} placeholder="Например, Склад" error={addError} />
        <BigButton title="Добавить" disabled={!name.trim()} loading={busy} onPress={add} />
      </Card>
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data?.map((d) => (
        <Card key={d.id} onPress={() => router.push({ pathname: '/departments/[id]', params: { id: String(d.id) } })}>
          <View style={styles.row}>
            <Text style={[styles.name, !d.is_active && styles.off]}>{d.name}</Text>
            {d.is_default ? <Text style={styles.badge}>по умолчанию</Text> : null}
          </View>
          {isWholeStore(d) ? (
            <Text style={styles.sub}>Весь магазин: для просмотра всех работ, мастер его не выбирает</Text>
          ) : !d.is_active ? (
            <Text style={styles.sub}>Выключен: мастера его не видят</Text>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: font.body, fontWeight: '700' },
  off: { color: colors.muted, textDecorationLine: 'line-through' },
  badge: { fontSize: font.small, fontWeight: '700', backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  sub: { fontSize: font.small, color: colors.muted, marginTop: 4 },
});
