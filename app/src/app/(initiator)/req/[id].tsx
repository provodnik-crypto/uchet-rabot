import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppHeader } from '../../../components/AppHeader';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { PhotoStrip } from '../../../components/PhotoStrip';
import { Screen, useScreenRefresh } from '../../../components/Screen';
import { PriorityPill, requestTone, StatusPill } from '../../../components/StatusPill';
import { Text } from '../../../components/Text';
import {
  cancelInitiatorRequest,
  initiatorRequestCard,
  submitInitiatorRating,
} from '../../../lib/initiators';
import { humanError } from '../../../lib/errors';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font, space } from '../../../theme';

/** Карточка заявки инициатора: что просили, где, кто мастер; свою «Новую» можно отменить. */
export default function InitiatorRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useFocusQuery(() => initiatorRequestCard(Number(id)), { key: `init:card:${id}`, persist: false });
  useScreenRefresh(q.reload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [sendingRating, setSendingRating] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const r = q.data;

  async function cancel() {
    if (!r) return;
    if (!(await confirm('Отменить заявку?', 'Мастер её ещё не взял. Отменённую заявку не вернуть.', 'Отменить'))) return;
    setBusy(true);
    setError(null);
    try {
      await cancelInitiatorRequest(r.id);
      router.replace('/');
    } catch (e) {
      setError(humanError(e));
      setBusy(false);
    }
  }

  async function sendRating() {
    if (!r || !score) return;
    setSendingRating(true);
    setRatingError(null);
    try {
      await submitInitiatorRating(r.id, score, ratingComment.trim() || null);
      await q.reload();
    } catch (e) {
      setRatingError(humanError(e));
    } finally {
      setSendingRating(false);
    }
  }

  return (
    <Screen header={<AppHeader title={r ? `Заявка № ${r.number}` : 'Заявка'} back />} status={q}>
      {r ? (
        <Card style={styles.card}>
          <View style={styles.pills}>
            {r.priority === 1 ? <PriorityPill priority={1} /> : null}
            <StatusPill {...requestTone({ status: r.status })} />
          </View>
          <Text style={styles.subject}>{r.subject}</Text>
          <Text style={styles.line}>
            Что сделать: <Text style={styles.strong}>{r.operation}</Text>
          </Text>
          <Text style={styles.line}>
            Где: <Text style={styles.strong}>{r.department_name ?? '—'}</Text>
            {r.place ? `, ${r.place}` : ''}
          </Text>
          <PhotoStrip photos={r.photos as unknown as { entry_id: number; photo_position: number; path: string; thumb_path: string }[]} />
          <Text style={styles.line}>
            Инициатор: <Text style={styles.strong}>{r.creator_name}</Text>
          </Text>
          <Text style={styles.line}>
            Мастер: <Text style={styles.strong}>{r.master_name ?? 'ещё не назначен'}</Text>
          </Text>
          {r.due_at ? (
            <Text style={styles.line}>
              Желаемая дата: <Text style={styles.strong}>{formatDate(r.due_at)}</Text>
            </Text>
          ) : null}
          {r.urgent_reason ? (
            <Text style={styles.line}>
              Почему срочно: <Text style={styles.strong}>{r.urgent_reason}</Text>
            </Text>
          ) : null}
          {r.materials ? (
            <Text style={styles.line}>
              Материалы: <Text style={styles.strong}>{r.materials}</Text>
            </Text>
          ) : null}
          {r.can_cancel ? (
            <BigButton title="Отменить заявку" variant="secondary" onPress={cancel} loading={busy} disabled={busy} />
          ) : null}
          {!r.can_cancel && r.status === 'waiting' && r.is_mine !== false ? (
            <Text style={styles.note}>Отменить можно только через МВСО — заявку уже передали мастеру.</Text>
          ) : null}
          {r.status === 'closed' ? (
            <Text style={styles.note}>
              Заявка закрыта МВСО{r.close_comment ? `. Причина: ${r.close_comment}` : null}
            </Text>
          ) : null}
          {r.can_rate ? (
            <Card style={styles.rateCard}>
              <Text style={styles.rateTitle}>Оцените, насколько вы довольны выполненной заявкой</Text>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="button"
                    accessibilityLabel={`Оценка ${n} из 5`}
                    onPress={() => setScore(n)}
                    hitSlop={6}
                  >
                    <Text style={[styles.star, score >= n ? styles.starOn : styles.starOff]}>★</Text>
                  </Pressable>
                ))}
              </View>
              {score > 0 && score <= 3 ? (
                <>
                  <Text style={styles.rateLabel}>Что пошло не так?</Text>
                  <Field
                    label="Комментарий"
                    value={ratingComment}
                    onChangeText={setRatingComment}
                    multiline
                    maxLength={300}
                    placeholder="Расскажите, что поправить"
                  />
                </>
              ) : score > 0 ? (
                <Field
                  label="Комментарий (по желанию)"
                  value={ratingComment}
                  onChangeText={setRatingComment}
                  multiline
                  maxLength={300}
                  placeholder="Что понравилось, что поправить"
                />
              ) : null}
              {ratingError ? <Text style={styles.error}>{ratingError}</Text> : null}
              <BigButton
                title="Отправить оценку"
                onPress={sendRating}
                loading={sendingRating}
                disabled={!score || sendingRating || (score <= 3 && !ratingComment.trim())}
              />
              <Text style={styles.note}>Оценку и комментарий видит только МВСО, мастер их не видит.</Text>
            </Card>
          ) : null}
          {r.rating_score ? (
            <Text style={styles.line}>
              Оценка: <Text style={styles.strong}>{'★'.repeat(r.rating_score)}{'☆'.repeat(5 - r.rating_score)}</Text>
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s12 },
  pills: { flexDirection: 'row', alignItems: 'center', gap: space.s8, flexWrap: 'wrap' },
  subject: { fontSize: font.lead, fontWeight: '700' },
  line: { fontSize: font.body },
  strong: { fontWeight: '700' },
  note: { fontSize: font.small, color: colors.muted },
  error: { color: colors.danger, fontSize: font.body },
  rateCard: { gap: space.s12 },
  rateTitle: { fontSize: font.lead, fontWeight: '700' },
  stars: { flexDirection: 'row', alignItems: 'center', gap: space.s8 },
  star: { fontSize: 32 },
  starOn: { color: colors.brand },
  starOff: { color: colors.border },
  rateLabel: { fontSize: font.body, fontWeight: '700' },
});
