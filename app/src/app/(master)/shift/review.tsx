import { router } from 'expo-router';
import { requestLabel } from '../../../lib/requests';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { formatDate } from '../../../lib/dates';
import { groupIsSent, shiftGroups, useDraft } from '../../../lib/draft';
import { humanError } from '../../../lib/errors';
import { formatMinutes, SHIFT_MINUTES } from '../../../lib/requestTime';
import { sendDraft } from '../../../lib/sendShift';
import { storeToday, storeYesterday } from '../../../lib/today';
import { TourTarget } from '../../../lib/tour';
import { colors, font } from '../../../theme';

export default function ReviewScreen() {
  const { draft, setWorkDate, clear, upsertEntry } = useDraft();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  if (!draft) {
    return (
      <Screen>
        <BigButton title="На главную" onPress={() => router.dismissAll()} />
      </Screen>
    );
  }
  const groups = shiftGroups(draft).filter(groupIsSent);
  const total = groups.reduce((a, g) => a + (g.time.minutes ?? 0), 0);
  const noTime = groups.filter((g) => !g.time.minutes);
  const today = storeToday();
  const yesterday = storeYesterday();
  const pending = draft.entries.filter((e) => !e.priceItemId).length;

  async function send() {
    if (!draft) return;
    if (noTime.length) {
      setError(`Укажите время: ${noTime.map((g) => g.request ?? 'без заявки').join(', ')}`);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await sendDraft(draft, upsertEntry, setProgress);
      clear();
      router.dismissAll();
      router.push({ pathname: '/shift/done', params: { entries: String(res.entries), pending: String(res.pending), edited: draft.editing ? '1' : '0' } });
    } catch (e) {
      // Черновик остаётся на телефоне — можно повторить, когда появится связь.
      setError(humanError(e));
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.h}>Дата смены</Text>
        <Segmented
          options={[
            { value: today, label: `Сегодня · ${formatDate(today)}` },
            { value: yesterday, label: `Вчера · ${formatDate(yesterday)}` },
          ]}
          value={draft.workDate}
          onChange={setWorkDate}
        />
      </Card>

      {groups.map((g) => (
        <Card key={g.request ?? '—'} style={styles.card}>
          <Text style={styles.request}>{g.request ? `Заявка ${requestLabel(g.request)}` : 'Без заявки'}</Text>
          <Text style={[styles.time, !g.time.minutes && styles.missing]}>
            {g.time.minutes ? `Время: ${formatMinutes(g.time.minutes)}` : 'Время не указано — вернитесь к списку'}
          </Text>
          {!g.entries.length ? <Text style={styles.meta}>Новых работ нет — только время</Text> : null}
          {g.entries.map((e) => (
            <View key={e.key} style={styles.row}>
              <Text style={styles.name}>
                {e.name}
                {!e.priceItemId ? <Text style={styles.custom}> · вне прайса</Text> : null}
              </Text>
              <Text style={styles.qty}>
                {e.quantity} {e.unitCode}
              </Text>
              <Text style={styles.meta}>
                {e.departmentName} · {e.performerNames.join(', ')}
                {e.note ? ` · ${e.note}` : ''}
                {e.photos?.length ? ` · фото: ${e.photos.length}` : ''}
              </Text>
            </View>
          ))}
        </Card>
      ))}

      <Text style={[styles.summary, total > SHIFT_MINUTES && styles.over]}>
        Время за смену: {formatMinutes(total)} из {formatMinutes(SHIFT_MINUTES)}
      </Text>
      {total > SHIFT_MINUTES ? (
        <Text style={styles.warnBox}>Время по заявкам больше длины смены. Проверьте, нет ли ошибки. Если всё верно — отправляйте.</Text>
      ) : null}
      <Text style={styles.summary}>
        Работ: {draft.entries.length}
        {pending ? ` · вне прайса (на оценку руководителю): ${pending}` : ''}
      </Text>
      {progress ? <Text style={styles.progress}>{progress}</Text> : null}
      {error ? <Text style={styles.error}>Не отправлено: {error}</Text> : null}
      <TourTarget id="review.send">
        <BigButton title={error ? 'Повторить' : 'Закрыть смену'} size="big" loading={sending} onPress={send} />
      <Text style={styles.meta}>Заявки останутся «В работе». На проверку заявку отправляют из её карточки: «Проверить и отправить».</Text>
      </TourTarget>
      <BigButton title="Вернуться к списку" variant="secondary" disabled={sending} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  h: { fontSize: font.body, fontWeight: '700' },
  request: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  row: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  name: { fontSize: font.body, fontWeight: '600' },
  custom: { fontSize: font.small, color: colors.muted, fontWeight: '400' },
  qty: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
  time: { fontSize: font.body, fontWeight: '800' },
  missing: { color: colors.danger },
  over: { color: colors.danger },
  warnBox: { fontSize: font.body, backgroundColor: '#FFF3C4', borderRadius: 12, padding: 12, fontWeight: '600' },
  summary: { fontSize: font.body, fontWeight: '600', textAlign: 'center' },
  error: { color: colors.danger, fontSize: font.body },
  progress: { fontSize: font.body, fontWeight: '700', textAlign: 'center' },
});
