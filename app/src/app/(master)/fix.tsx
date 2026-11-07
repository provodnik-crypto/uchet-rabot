import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { Field } from '../../components/Field';
import { PhotoPicker } from '../../components/PhotoPicker';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { humanError } from '../../lib/errors';
import { listUnits, type Unit } from '../../lib/price';
import { formatQuantity, myEntries, parseQuantity, resubmitEntry } from '../../lib/shift';
import { useFocusQuery } from '../../lib/useQuery';
import { fetchEntryPhotos, remoteToDraft, toPayload, uploadPhotos, type DraftPhoto, type RemotePhoto } from '../../lib/workPhotos';
import { colors, font, space, stroke } from '../../theme';

export default function FixEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = Number(id);
  const { data, error, loading, reload } = useFocusQuery(async () => {
    const [rows, units, photos] = await Promise.all([myEntries(60), listUnits(), fetchEntryPhotos([entryId]).catch((): Record<number, RemotePhoto[]> => ({}))]);
    return { entry: rows.find((r) => r.entry_id === entryId) ?? null, units, photos: remoteToDraft(photos[entryId]) };
  });
  const [name, setName] = useState('');
  const [unitId, setUnitId] = useState<number | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [workPhotos, setWorkPhotos] = useState<DraftPhoto[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.entry) return;
    setName(data.entry.name);
    setUnitId(data.entry.unit_id);
    setQty(formatQuantity(data.entry.quantity));
    setNote(data.entry.note ?? '');
    setWorkPhotos(data.photos);
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
  // работа из прайса: название и единица — из прайса, меняется объём и фото
  const fromPrice = entry.price_item_id != null;

  async function send() {
    const p = parseQuantity(qty, unit?.integer_only ?? false);
    if (!fromPrice && name.trim().length < 3) return setMessage('Введите название работы (не короче 3 букв)');
    if (!unit) return setMessage('Выберите единицу');
    if (p.error) return setMessage(p.error);
    setBusy(true);
    setMessage(null);
    try {
      const ready = new Map<string, DraftPhoto>();
      await uploadPhotos(
        workPhotos,
        (ph) => ready.set(ph.key, ph),
        (done, total) => setProgress(total ? `Загружаем фото: ${done} из ${total}` : null),
      );
      const finalPhotos = workPhotos.map((ph) => ready.get(ph.key) ?? ph);
      setWorkPhotos(finalPhotos);
      await resubmitEntry(entry!.entry_id, name.trim().replace(/\s+/g, ' '), unit.id, p.value!, note, toPayload(finalPhotos), fromPrice ? entry!.price_item_id : null);
      router.back();
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Screen>
      <Card style={styles.alert}>
        <Text style={styles.alertTitle}>Руководитель отклонил работу</Text>
        <Text style={styles.alertText}>{entry.reject_comment}</Text>
      </Card>
      <Card style={styles.card}>
        {fromPrice ? (
          <Text style={styles.name}>{entry.name}</Text>
        ) : (
          <>
            <Field label="Название работы" value={name} onChangeText={setName} multiline />
            <Text style={styles.label}>Единица измерения</Text>
            <View style={styles.chips}>
              {data.units.map((u) => (
                <Chip key={u.id} label={u.code} selected={u.id === unitId} onPress={() => setUnitId(u.id)} />
              ))}
            </View>
          </>
        )}
        <Field label={unit ? `Объём, ${unit.code}` : 'Объём'} value={qty} onChangeText={setQty} keyboardType="decimal-pad" />
        <Field label="Примечание" value={note} onChangeText={setNote} multiline maxLength={500} />
        <Text style={styles.label}>Фото работы</Text>
        <PhotoPicker photos={workPhotos} onChange={setWorkPhotos} hint />
      </Card>
      {progress ? <Text style={styles.label}>{progress}</Text> : null}
      {message ? <Text style={styles.err}>{message}</Text> : null}
      <BigButton title="Отправить снова" size="big" loading={busy} onPress={send} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  alert: { borderWidth: stroke.outline, borderColor: colors.danger, gap: space.s4 },
  alertTitle: { fontSize: font.body, fontWeight: '800', color: colors.danger },
  alertText: { fontSize: font.body },
  card: { gap: space.s12 },
  name: { fontSize: font.body, fontWeight: '700' },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  meta: { fontSize: font.body, color: colors.muted },
  err: { color: colors.danger, fontSize: font.body },
});
