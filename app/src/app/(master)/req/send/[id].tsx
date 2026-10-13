import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../../components/BigButton';
import { Card } from '../../../../components/Card';
import { Field } from '../../../../components/Field';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { formatDate } from '../../../../lib/dates';
import { requestList, useDraft } from '../../../../lib/draft';
import { humanError } from '../../../../lib/errors';
import { requestCard, sendRequestForReview } from '../../../../lib/requests';
import { formatMinutes, formatPlan } from '../../../../lib/requestTime';
import { draftHasContent, sendDraft } from '../../../../lib/sendShift';
import { formatQuantity } from '../../../../lib/shift';
import { useFocusQuery } from '../../../../lib/useQuery';
import { colors, font } from '../../../../theme';

/** «Проверить и отправить»: итог по одной заявке за все дни → «На проверке» у руководителя. */
export default function SendRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: r, error, loading, reload } = useFocusQuery(() => requestCard({ id: Number(id) }));
  const { draft, upsertEntry, markSent } = useDraft();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!r) return <Screen><StateView loading={loading} error={error} onRetry={reload} /></Screen>;

  // Сегодняшние работы и время по этой заявке, ещё не отправленные на сервер.
  const unsent = draft && !draft.editing;
  const draftEntries = unsent ? draft.entries.filter((e) => e.requestNumber === r.number) : [];
  const todayMinutes = unsent ? requestList(draft).find((t) => t.number === r.number)?.minutes ?? 0 : 0;
  const total = r.spent_minutes + todayMinutes;
  const over = r.plan_minutes != null && total > r.plan_minutes;
  const nothing = !r.works.length && !draftEntries.length && total === 0;

  async function send() {
    if (!r) return;
    setBusy(true);
    setErr(null);
    try {
      // Сначала сохраняем день (работы и время по всем заявкам смены), потом отправляем эту заявку.
      if (draft && draftHasContent(draft)) {
        await sendDraft(draft, upsertEntry, setProgress);
        markSent();
      }
      await sendRequestForReview(r.id, comment.trim() || null);
      router.back();
    } catch (e) {
      setErr(humanError(e));
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.number}>{r.number}</Text>
      {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}

      <Card style={styles.card}>
        <Text style={styles.label}>Время</Text>
        <Text style={[styles.big, over && styles.over]}>
          Факт: {formatMinutes(total)}
          {r.plan_minutes != null ? ` · примерно было ${formatPlan(r.plan_minutes)}` : ''}
        </Text>
        {over ? <Text style={styles.overText}>Дольше, чем планировали. Можно пояснить в комментарии.</Text> : null}
        {r.time_by_day.map((t, i) => (
          <Text key={i} style={styles.meta}>
            {formatDate(t.work_date)} · {formatMinutes(t.minutes)} · {t.author}
          </Text>
        ))}
        {todayMinutes ? <Text style={styles.meta}>{formatDate(draft!.workDate)} · {formatMinutes(todayMinutes)} · сегодня, ещё не отправлено</Text> : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>Работы: {r.works.length + draftEntries.length}</Text>
        {draftEntries.map((e) => (
          <View key={e.key} style={styles.row}>
            <Text style={styles.name}>{e.name}</Text>
            <Text style={styles.meta}>
              {e.quantity} {e.unitCode} · {e.performerNames.join(', ')} · сегодня
            </Text>
          </View>
        ))}
        {r.works.map((w, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.name}>{w.name}</Text>
            <Text style={styles.meta}>
              {formatQuantity(w.quantity)} {w.unit} · {w.performers} · {formatDate(w.work_date)}
            </Text>
          </View>
        ))}
        {!r.works.length && !draftEntries.length ? <Text style={styles.meta}>Работ нет — только время.</Text> : null}
      </Card>

      <Field label="Комментарий руководителю (необязательно)" value={comment} onChangeText={setComment} multiline placeholder="Что сделано, что осталось" />

      {nothing ? <Text style={styles.err}>Добавьте работу или время — иначе отправлять нечего.</Text> : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}
      {progress ? <Text style={styles.meta}>{progress}</Text> : null}
      <BigButton title="Отправить на проверку" size="big" loading={busy} disabled={nothing} onPress={send} />
      <Text style={styles.hint}>
        Уйдёт одна эта заявка. Сегодняшние работы по другим заявкам тоже сохранятся на сервере, но останутся у вас «В работе».
      </Text>
      <BigButton title="Назад" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.secondary },
  card: { gap: 6 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  big: { fontSize: font.body, fontWeight: '800' },
  over: { color: colors.danger },
  overText: { fontSize: font.small, color: colors.danger },
  row: { gap: 2, paddingTop: 4 },
  name: { fontSize: font.body, fontWeight: '600' },
  err: { color: colors.danger, fontSize: font.body },
  hint: { fontSize: font.small - 1, color: colors.muted },
});
