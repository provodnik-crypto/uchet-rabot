import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppHeader } from '../../../../components/AppHeader';
import { BigButton } from '../../../../components/BigButton';
import { PhotoPicker } from '../../../../components/PhotoPicker';
import { Screen, useKeepAboveKeyboard } from '../../../../components/Screen';
import { Section } from '../../../../components/Section';
import { StateView } from '../../../../components/StateView';
import { Text, TextInput } from '../../../../components/Text';
import { formatDate } from '../../../../lib/dates';
import { humanError } from '../../../../lib/errors';
import { requestCard, requestLabel, sendRequestForReviewPhotos } from '../../../../lib/requests';
import { formatQuantity } from '../../../../lib/shift';
import { TourTarget } from '../../../../lib/tour';
import { useFocusQuery } from '../../../../lib/useQuery';
import { toPayload, uploadAll, type DraftPhoto } from '../../../../lib/workPhotos';
import { colors, font, radius, space, stroke, textArea } from '../../../../theme';

/** «Отправить на проверку» — три шага: проверить работы, фото результата (минимум одно), комментарий. */
export default function SendRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFocusQuery(() => requestCard({ id: Number(id) }), { key: `card:${id}`, persist: false });
  const { data: r, error, loading, reload } = query;
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const keep = useKeepAboveKeyboard();

  const header = <AppHeader title="Отправить на проверку" subtitle={r ? requestLabel(r.number) : undefined} back />;
  if (!r) return <Screen header={header}><StateView loading={loading} error={error} onRetry={reload} /></Screen>;

  // заявка уже не у мастера в работе (ушла на проверку — в том числе если ответ на отправку потерялся)
  if (r.status !== 'in_work' || !r.is_responsible) {
    return (
      <Screen status={query} header={header}>
        <Section>
          <Text style={styles.body}>
            {r.status === 'review' ? 'Заявка уже на проверке у руководителя. Отправлять ещё раз не нужно.' : 'Заявка сейчас не у вас в работе — отправить её нельзя.'}
          </Text>
          <BigButton title="На главную" variant="dark" onPress={() => router.dismissTo('/')} />
        </Section>
      </Screen>
    );
  }

  // отклонённые работы не считаются: без других работ сервер не примет отправку
  const works = r.works.filter((w) => w.status !== 'rejected');
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
    <Screen
      status={query}
      header={header}
      footer={
        <>
          {progress ? <Text style={styles.meta}>{progress}</Text> : null}
          {err ? <Text style={styles.err}>Не отправлено: {err}</Text> : null}
          {!ready ? <Text style={styles.meta}>{!works.length ? 'Сначала добавьте работу в карточке заявки.' : 'Добавьте хотя бы одно фото результата.'}</Text> : null}
          <TourTarget id="send.go">
            <BigButton title={err ? 'Повторить' : 'Отправить'} variant="dark" size="big" loading={busy} disabled={!ready} onPress={send} />
          </TourTarget>
        </>
      }
    >
      <Section title="1 · Проверьте работы">
        {works.map((w, i) => (
          <View key={w.id ?? i} style={[styles.row, i > 0 && styles.line]}>
            <View style={styles.flex}>
              <Text style={styles.body}>{w.name}</Text>
              <Text style={styles.meta}>
                {formatDate(w.work_date)}
                {w.performers ? ` · ${w.performers}` : ''}
              </Text>
            </View>
            <Text style={styles.qty}>
              {formatQuantity(w.quantity)} {w.unit}
            </Text>
          </View>
        ))}
        {!works.length ? <Text style={styles.err}>Работ нет — вернитесь и нажмите «+ Добавить работу».</Text> : null}
        {works.length ? <Text style={styles.meta}>Что-то не так — вернитесь в заявку и нажмите на работу.</Text> : null}
      </Section>

      <TourTarget id="send.photo">
        <Section title="2 · Фото результата">
          <PhotoPicker photos={photos} onChange={setPhotos} required />
        </Section>
      </TourTarget>

      <Section title="3 · Комментарий (необязательно)">
        <View ref={keep.ref} collapsable={false}>
        <TextInput
          onFocus={keep.onFocus}
          onBlur={keep.onBlur}
          value={comment}
          onChangeText={setComment}
          multiline
          textAlignVertical="top"
          maxLength={1000}
          placeholder="Например: заменил 4 крепежа, механизм работает"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Комментарий руководителю"
          style={styles.input}
        />
        </View>
      </Section>
      <Text style={styles.meta}>После отправки заявка уйдёт руководителю, а вы сможете взять следующую.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: space.s2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s12, paddingVertical: space.s8 },
  line: { borderTopWidth: stroke.hair, borderTopColor: colors.border },
  body: { fontSize: font.body },
  qty: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.caption, color: colors.secondary },
  err: { color: colors.danger, fontSize: font.body },
  input: {
    minHeight: textArea.minHeight,
    borderWidth: stroke.hair,
    borderColor: colors.field,
    borderRadius: radius.small,
    paddingHorizontal: space.s12,
    paddingVertical: space.s10,
    fontSize: font.body,
  },
});
