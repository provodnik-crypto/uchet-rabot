import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../../components/BigButton';
import { Card } from '../../../../components/Card';
import { Field } from '../../../../components/Field';
import { Screen } from '../../../../components/Screen';
import { StateView } from '../../../../components/StateView';
import { formatDate } from '../../../../lib/dates';
import { MOVED_TEXT, useDraft } from '../../../../lib/draft';
import { withDraft } from '../../../../lib/requestDraft';
import { humanError } from '../../../../lib/errors';
import { requestCard, sendRequestForReview, requestLabel } from '../../../../lib/requests';
import { draftHasContent, sendDraft } from '../../../../lib/sendShift';
import { formatQuantity } from '../../../../lib/shift';
import { useFocusQuery } from '../../../../lib/useQuery';
import { colors, font } from '../../../../theme';

/** «Проверить и отправить»: итог по одной заявке за все дни → «На проверке» у руководителя. */
export default function SendRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFocusQuery(() => requestCard({ id: Number(id) }), { key: `card:${id}`, persist: false });
  const { data: r, error, loading, reload } = query;
  const { draft, upsertEntry, markSent, moveUnsent } = useDraft();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!r) return <Screen><StateView loading={loading} error={error} onRetry={reload} /></Screen>;

  // Работы с сервера плюс смена на телефоне (она заменяет уже отправленную версию того же дня).
  const { works, draftEntries } = withDraft(r, draft);
  const nothing = !works.length && !draftEntries.length;

  async function send() {
    if (!r) return;
    setBusy(true);
    setErr(null);
    try {
      // Сначала сохраняем день (работы по всем заявкам смены), потом отправляем эту заявку.
      if (draft && draftHasContent(draft)) {
        await sendDraft(draft, upsertEntry, setProgress);
        markSent();
      }
      await sendRequestForReview(r.id, comment.trim() || null);
      router.back();
    } catch (e) {
      const text = humanError(e);
      // Отправленную вчера смену уже нельзя менять — новое переносится в смену за сегодня, нажмите ещё раз.
      setErr(/только в день отправки|уже обработал работы этой смены/.test(text) && (await moveUnsent()) ? MOVED_TEXT : text);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.number}>{requestLabel(r.number)}</Text>
      {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}

      <Card style={styles.card}>
        <Text style={styles.label}>Работы: {works.length + draftEntries.length}</Text>
        {draftEntries.map((e) => (
          <View key={e.key} style={styles.row}>
            <Text style={styles.name}>{e.name}</Text>
            <Text style={styles.meta}>
              {e.quantity} {e.unitCode} · {e.performerNames.join(', ')} · сегодня
            </Text>
          </View>
        ))}
        {works.map((w, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.name}>{w.name}</Text>
            <Text style={styles.meta}>
              {formatQuantity(w.quantity)} {w.unit} · {w.performers} · {formatDate(w.work_date)}
            </Text>
          </View>
        ))}
        {!works.length && !draftEntries.length ? <Text style={styles.meta}>Работ пока нет.</Text> : null}
      </Card>

      <Field label="Комментарий руководителю (необязательно)" value={comment} onChangeText={setComment} multiline placeholder="Что сделано, что осталось" />

      {nothing ? <Text style={styles.err}>Добавьте хотя бы одну работу по заявке — без неё отправить нельзя.</Text> : null}
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
  row: { gap: 2, paddingTop: 4 },
  name: { fontSize: font.body, fontWeight: '600' },
  err: { color: colors.danger, fontSize: font.body },
  hint: { fontSize: font.small - 1, color: colors.muted },
});
