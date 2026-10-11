import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { humanError } from '../../lib/errors';
import { listUnits, type Unit } from '../../lib/price';
import { formatQuantity, myEntries, parseQuantity, resubmitEntry } from '../../lib/shift';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font } from '../../theme';

export default function FixEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = Number(id);
  const { data, error, loading, reload } = useFocusQuery(async () => {
    const [rows, units] = await Promise.all([myEntries(60), listUnits()]);
    return { entry: rows.find((r) => r.entry_id === entryId) ?? null, units };
  });
  const [name, setName] = useState('');
  const [unitId, setUnitId] = useState<number | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.entry) return;
    setName(data.entry.name);
    setUnitId(data.entry.unit_id);
    setQty(formatQuantity(data.entry.quantity));
    setNote(data.entry.note ?? '');
  }, [data]);

  if (!data) {
    return (
      <Screen>
        <StateView loading={loading} error={error} onRetry={reload} />
      </Screen>
    );
  }
  const entry = data.entry;
  if (!entry || entry.status !== 'rejected') {
    return (
      <Screen>
        <Text style={styles.meta}>Эта работа уже исправлена или обработана.</Text>
        <BigButton title="Назад" onPress={() => router.back()} />
      </Screen>
    );
  }
  const unit: Unit | undefined = data.units.find((u) => u.id === unitId);

  async function send() {
    const p = parseQuantity(qty, unit?.integer_only ?? false);
    if (name.trim().length < 3) return setMessage('Введите название работы (не короче 3 букв)');
    if (!unit) return setMessage('Выберите единицу');
    if (p.error) return setMessage(p.error);
    setBusy(true);
    setMessage(null);
    try {
      await resubmitEntry(entry!.entry_id, name.trim().replace(/\s+/g, ' '), unit.id, p.value!, note);
      router.back();
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card style={styles.alert}>
        <Text style={styles.alertTitle}>Руководитель отклонил работу</Text>
        <Text style={styles.alertText}>{entry.reject_comment}</Text>
      </Card>
      <Card style={styles.card}>
        <Field label="Название работы" value={name} onChangeText={setName} multiline />
        <Text style={styles.label}>Единица измерения</Text>
        <View style={styles.chips}>
          {data.units.map((u) => (
            <Chip key={u.id} label={u.code} selected={u.id === unitId} onPress={() => setUnitId(u.id)} />
          ))}
        </View>
        <Field label={unit ? `Объём, ${unit.code}` : 'Объём'} value={qty} onChangeText={setQty} keyboardType="decimal-pad" />
        <Field label="Примечание" value={note} onChangeText={setNote} multiline maxLength={500} />
      </Card>
      {message ? <Text style={styles.err}>{message}</Text> : null}
      <BigButton title="Отправить снова" size="big" loading={busy} onPress={send} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  alert: { borderWidth: 2, borderColor: colors.danger, gap: 4 },
  alertTitle: { fontSize: font.body, fontWeight: '800', color: colors.danger },
  alertText: { fontSize: font.body },
  card: { gap: 12 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  meta: { fontSize: font.body, color: colors.muted },
  err: { color: colors.danger, fontSize: font.body },
});
