import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { RequestBadges } from '../../../components/RequestBadges';
import { RequestFeed } from '../../../components/RequestFeed';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { acceptRequest, markRequestRead, requestCard, returnRequest, requestLabel } from '../../../lib/requests';
import { formatMinutes, formatPlan } from '../../../lib/requestTime';
import { formatQuantity } from '../../../lib/shift';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

const workStatus = { priced: 'Цена есть', pending: 'Ждёт цены (На оценке)', rejected: 'Отклонена', awaiting: 'Цена есть' } as const;

/** Проверка заявки: работы, время против примерного, комментарий мастера; «Принять» или «Вернуть». */
export default function ReviewRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: r, error, loading, reload } = useFocusQuery(() => requestCard({ id: Number(id) }));
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useFocusEffect(useCallback(() => void markRequestRead(Number(id)), [id]));

  if (!r) return <Screen><StateView loading={loading} error={error} onRetry={reload} /></Screen>;
  const over = r.plan_minutes != null && r.spent_minutes > r.plan_minutes;
  const sendNote = r.events.find((e) => e.kind === 'send')?.comment;
  const pending = r.works.filter((w) => w.status === 'pending').length;

  async function act(kind: 'accept' | 'return') {
    if (!r) return;
    if (kind === 'return' && comment.trim().length < 3) {
      setErr('Напишите мастеру, что исправить');
      return;
    }
    if (kind === 'accept' && !(await confirm('Принять заявку?', 'Работы по ней войдут в суммы мастеров.', 'Принять'))) return;
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
    <Screen>
      <RequestBadges status={r.status} priority={r.priority} />
      <Text style={styles.number}>{requestLabel(r.number)}</Text>
      {r.operation ? <Text style={styles.op}>{r.operation}</Text> : null}
      {r.description ? <Text style={styles.body}>{r.description}</Text> : null}
      <Text style={styles.meta}>
        Взял {r.responsible_name}
        {r.members.length ? ` · напарники: ${r.members.map((m) => m.name).join(', ')}` : ''}
        {r.taken_at ? ` · с ${formatDate(r.taken_at.slice(0, 10))}` : ''}
      </Text>

      <Card style={styles.card}>
        <Text style={styles.label}>Время</Text>
        <Text style={[styles.big, over && styles.over]}>
          Факт {formatMinutes(r.spent_minutes)}
          {r.plan_minutes != null ? ` · примерно было ${formatPlan(r.plan_minutes)}` : ' · примерное время не указано'}
        </Text>
        {r.time_by_day.map((t, i) => (
          <Text key={i} style={styles.meta}>
            {formatDate(t.work_date)} · {formatMinutes(t.minutes)} · {t.author}
          </Text>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>Работы: {r.works.length}</Text>
        {r.works.map((w, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.name}>{w.name}</Text>
            <Text style={styles.meta}>
              {formatDate(w.work_date)} · {formatQuantity(w.quantity)} {w.unit} · {w.performers}
            </Text>
            <Text style={[styles.meta, w.status === 'pending' && styles.warn]}>{workStatus[w.status]}</Text>
          </View>
        ))}
        {pending ? <Text style={styles.warn}>Работ вне прайса без цены: {pending}. Цену назначьте в «На оценке» — до или после приёмки.</Text> : null}
      </Card>

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
  card: { gap: 6 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  big: { fontSize: font.body, fontWeight: '800' },
  over: { color: colors.danger },
  row: { gap: 2, paddingTop: 4 },
  name: { fontSize: font.body, fontWeight: '600' },
  warn: { color: '#BE9200', fontWeight: '700', fontSize: font.small },
  err: { color: colors.danger, fontSize: font.body },
  event: { fontSize: font.small, color: colors.muted },
});
