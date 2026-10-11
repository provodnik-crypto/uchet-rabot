import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Screen } from '../../../components/Screen';
import { formatDate } from '../../../lib/dates';
import { groupByRequest, useDraft } from '../../../lib/draft';
import { humanError } from '../../../lib/errors';
import { parseQuantity, submitShift, type SubmitEntry } from '../../../lib/shift';
import { storeToday, storeYesterday } from '../../../lib/today';
import { colors, font } from '../../../theme';

export default function ReviewScreen() {
  const { draft, setWorkDate, clear } = useDraft();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!draft) {
    return (
      <Screen>
        <BigButton title="На главную" onPress={() => router.dismissAll()} />
      </Screen>
    );
  }
  const groups = groupByRequest(draft.entries);
  const today = storeToday();
  const yesterday = storeYesterday();
  const pending = draft.entries.filter((e) => !e.priceItemId).length;

  async function send() {
    if (!draft) return;
    setSending(true);
    setError(null);
    try {
      // Порядок работ — как на экране: по заявкам.
      const entries: SubmitEntry[] = groups.flatMap((g) =>
        g.entries.map((e) => ({
          request_number: e.requestNumber,
          department_id: e.departmentId,
          ...(e.priceItemId ? { price_item_id: e.priceItemId } : { custom_name: e.customName ?? e.name, unit_id: e.unitId }),
          quantity: parseQuantity(e.quantity, e.integerOnly).value ?? Number(e.quantity.replace(',', '.')),
          note: e.note || null,
          performer_ids: e.performerIds,
        })),
      );
      const res = await submitShift({ client_uuid: draft.clientUuid, work_date: draft.workDate, entries });
      clear();
      router.dismissAll();
      router.push({ pathname: '/shift/done', params: { entries: String(res.entries), pending: String(res.pending), edited: draft.editing ? '1' : '0' } });
    } catch (e) {
      // Черновик остаётся на телефоне — можно повторить, когда появится связь.
      setError(humanError(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.h}>Дата смены</Text>
        <View style={styles.chips}>
          <Chip label={`Сегодня · ${formatDate(today)}`} selected={draft.workDate === today} onPress={() => setWorkDate(today)} />
          <Chip label={`Вчера · ${formatDate(yesterday)}`} selected={draft.workDate === yesterday} onPress={() => setWorkDate(yesterday)} />
        </View>
      </Card>

      {groups.map((g) => (
        <Card key={g.request ?? '—'} style={styles.card}>
          <Text style={styles.request}>{g.request ? `Заявка ${g.request}` : 'Без заявки'}</Text>
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
              </Text>
            </View>
          ))}
        </Card>
      ))}

      <Text style={styles.summary}>
        Работ: {draft.entries.length}
        {pending ? ` · вне прайса (на оценку руководителю): ${pending}` : ''}
      </Text>
      {error ? <Text style={styles.error}>Не отправлено: {error}</Text> : null}
      <BigButton title={error ? 'Повторить' : 'Отправить'} size="big" loading={sending} onPress={send} />
      <BigButton title="Вернуться к списку" variant="secondary" disabled={sending} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  h: { fontSize: font.body, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  request: { fontSize: font.small, fontWeight: '800', color: colors.muted, textTransform: 'uppercase' },
  row: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  name: { fontSize: font.body, fontWeight: '700' },
  custom: { fontSize: font.small, color: colors.muted, fontWeight: '400' },
  qty: { fontSize: font.body, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  summary: { fontSize: font.body, fontWeight: '600', textAlign: 'center' },
  error: { color: colors.danger, fontSize: font.body },
});
