import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../../components/BigButton';
import { Card } from '../../../../components/Card';
import { Field } from '../../../../components/Field';
import { PhotoPicker } from '../../../../components/PhotoPicker';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { formatDate } from '../../../../lib/dates';
import { humanError } from '../../../../lib/errors';
import { requestCard, requestLabel, sendRequestForReviewPhotos } from '../../../../lib/requests';
import { formatQuantity } from '../../../../lib/shift';
import { TourTarget } from '../../../../lib/tour';
import { useFocusQuery } from '../../../../lib/useQuery';
import { toPayload, uploadAll, type DraftPhoto } from '../../../../lib/workPhotos';
import { colors, font } from '../../../../theme';

/** «Отправить на проверку» — одно окно: работы по заявке, фото результата (минимум одно), комментарий. */
export default function SendRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFocusQuery(() => requestCard({ id: Number(id) }), { key: `card:${id}`, persist: false });
  const { data: r, error, loading, reload } = query;
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!r) return <Screen><StateView loading={loading} error={error} onRetry={reload} /></Screen>;

  const works = r.works;
  const ready = works.length > 0 && photos.length > 0;

  async function send() {
    if (!r || !ready) return;
    setBusy(true);
    setErr(null);
    try {
      // фото загружаются в хранилище; уже загруженные при прошлой попытке не грузятся повторно
      const uploaded = await uploadAll(photos, setProgress);
      setPhotos(uploaded);
      await sendRequestForReviewPhotos(r.id, comment.trim() || null, toPayload(uploaded));
      router.dismissTo('/');
    } catch (e) {
      // фото и комментарий остаются — можно нажать «Повторить»
      setErr(humanError(e));
      reload();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Screen status={query}>
      <Text style={styles.number}>{requestLabel(r.number)}</Text>
      {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}

      <Card style={styles.card}>
        <Text style={styles.label}>Работы: {works.length}</Text>
        {works.map((w, i) => (
          <View key={w.id ?? i} style={styles.row}>
            <Text style={styles.name}>{w.name}</Text>
            <Text style={styles.meta}>
              {formatQuantity(w.quantity)} {w.unit} · {w.performers} · {formatDate(w.work_date)}
            </Text>
          </View>
        ))}
        {!works.length ? <Text style={styles.err}>Работ нет — вернитесь и нажмите «+ Добавить работу».</Text> : null}
      </Card>

      <TourTarget id="send.photo">
        <Card style={styles.card}>
          <Text style={styles.label}>Фото результата — хотя бы одно (до 3)</Text>
          <PhotoPicker photos={photos} onChange={setPhotos} required />
        </Card>
      </TourTarget>

      <Field label="Комментарий руководителю (необязательно)" value={comment} onChangeText={setComment} multiline placeholder="Что сделано, что осталось" />

      {progress ? <Text style={styles.meta}>{progress}</Text> : null}
      {err ? <Text style={styles.err}>Не отправлено: {err}</Text> : null}
      <TourTarget id="send.go">
        <BigButton title={err ? 'Повторить' : 'Отправить на проверку'} size="big" loading={busy} disabled={!ready} onPress={send} />
      </TourTarget>
      {!photos.length && works.length ? <Text style={styles.hint}>Сфотографируйте результат — без фото отправить нельзя.</Text> : null}
      <Text style={styles.hint}>После отправки заявка уйдёт руководителю, а вы сможете взять следующую.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.secondary },
  card: { gap: 6 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  row: { gap: 2, paddingTop: 4 },
  name: { fontSize: font.body, fontWeight: '600' },
  err: { color: colors.danger, fontSize: font.body },
  hint: { fontSize: font.small - 1, color: colors.muted },
});
