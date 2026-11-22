import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppHeader } from '../../../components/AppHeader';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { LoadStatus } from '../../../components/LoadStatus';
import { PhotoStrip } from '../../../components/PhotoStrip';
import { Screen, useScreenRefresh } from '../../../components/Screen';
import { PriorityPill, requestTone, StatusPill } from '../../../components/StatusPill';
import { Text } from '../../../components/Text';
import { cancelInitiatorRequest, initiatorRequestCard } from '../../../lib/initiators';
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

  return (
    <Screen header={<AppHeader title={r ? `Заявка № ${r.number}` : 'Заявка'} back />} status={q}>
      <LoadStatus status={q} />
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
            Подала: <Text style={styles.strong}>{r.creator_name}</Text>
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
          {!r.can_cancel && r.status === 'waiting' ? (
            <Text style={styles.note}>Отменить можно только через руководителя — заявку уже взяли в работу.</Text>
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
});
