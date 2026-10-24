import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../../../components/Text';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { RequestBadges } from '../../../components/RequestBadges';
import { PhotoStrip } from '../../../components/PhotoStrip';
import type { RemotePhoto } from '../../../lib/workPhotos';
import { RequestFeed } from '../../../components/RequestFeed';
import { WorksMoney } from '../../../components/WorksMoney';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { acceptRequest, markRequestRead, requestCard, requestLabel, requestMoney, returnRequest } from '../../../lib/requests';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font, space } from '../../../theme';

/** Проверка заявки: работы, комментарий мастера; «Принять» или «Вернуть». */
export default function ReviewRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFocusQuery(() => requestCard({ id: Number(id) }), { key: `card:${id}`, persist: false });
  const { data: r, error, loading, reload } = query;
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useFocusEffect(useCallback(() => void markRequestRead(Number(id)), [id]));

  if (!r) return <Screen><StateView loading={loading} error={error} onRetry={reload} /></Screen>;
  const sendNote = r.events.find((e) => e.kind === 'send')?.comment;

  async function act(kind: 'accept' | 'return') {
    if (!r) return;
    if (kind === 'return' && comment.trim().length < 3) {
      setErr('Напишите мастеру, что исправить');
      return;
    }
    if (kind === 'accept') {
      // работы без цены войдут в суммы только после оценки — так и пишем
      const unpriced = await requestMoney(r.id).then((m) => m.unpriced).catch(() => 0);
      const text = unpriced
        ? `Работы с ценой войдут в суммы мастеров. Без цены: ${unpriced} — войдут после оценки в «На оценке».`
        : 'Работы по ней войдут в суммы мастеров.';
      if (!(await confirm('Принять заявку?', text, 'Принять'))) return;
    }
    setBusy(kind);
    setErr(null);
    try {
      if (kind === 'accept') await acceptRequest(r.id, comment.trim() || null);
      else await returnRequest(r.id, comment.trim());
      router.back();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen status={query}>
      <RequestBadges status={r.status} priority={r.priority} />
      <Text style={styles.number}>{requestLabel(r.number)}</Text>
      {r.operation ? <Text style={styles.op}>{r.operation}</Text> : null}
      {r.description ? <Text style={styles.body}>{r.description}</Text> : null}
      <Text style={styles.meta}>
        Взял {r.responsible_name}
        {r.members.length ? ` · напарники: ${r.members.map((m) => m.name).join(', ')}` : ''}
        {r.taken_at ? ` · с ${formatDate(r.taken_at.slice(0, 10))}` : ''}
      </Text>

      <WorksMoney requestId={r.id} works={r.works} onChanged={reload} />

      {r.result_photos?.length ? (
        <Card style={styles.card}>
          <Text style={styles.label}>Фото результата</Text>
          <PhotoStrip photos={r.result_photos as unknown as RemotePhoto[]} />
        </Card>
      ) : null}
      {sendNote ? (
        <Card style={styles.card}>
          <Text style={styles.label}>Комментарий мастера</Text>
          <Text style={styles.body}>{sendNote}</Text>
        </Card>
      ) : null}

      <Field label="Комментарий (при «Вернуть» — обязательно)" value={comment} onChangeText={setComment} multiline placeholder="Что исправить или доделать" />
      {err ? <Text style={styles.err}>{err}</Text> : null}
      {r.status === 'review' ? (
        <>
          <BigButton title="Принять" size="big" loading={busy === 'accept'} disabled={!!busy} onPress={() => act('accept')} />
          <BigButton title="Вернуть мастеру" variant="danger" loading={busy === 'return'} disabled={!!busy} onPress={() => act('return')} />
        </>
      ) : (
        <Text style={styles.meta}>Заявка уже не на проверке.</Text>
      )}

      {r ? <RequestFeed requestId={r.id} events={r.events} onSent={reload} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: { fontSize: font.title, fontWeight: '800' },
  op: { fontSize: font.body, fontWeight: '700' },
  body: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.secondary },
  card: { gap: space.s6 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  row: { gap: space.s2, paddingTop: space.s4 },
  name: { fontSize: font.body, fontWeight: '600' },
  warn: { color: colors.brandDark, fontWeight: '700', fontSize: font.small },
  err: { color: colors.danger, fontSize: font.body },
  event: { fontSize: font.small, color: colors.muted },
});
