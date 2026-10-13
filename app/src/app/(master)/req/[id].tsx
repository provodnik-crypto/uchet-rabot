import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { useDraft } from '../../../lib/draft';
import { formatRegistered, requestCard, type RequestWork } from '../../../lib/requests';
import { formatQuantity, myOpenRequests } from '../../../lib/shift';
import { storeToday } from '../../../lib/today';
import { TourTarget } from '../../../lib/tour';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font, radius } from '../../../theme';

const statusLabel: Record<RequestWork['status'], string> = { priced: 'Принято', pending: 'На оценке', rejected: 'Отклонено' };

/** Карточка заявки: полный текст, кому назначена, работы по ней. */
export default function RequestCardScreen() {
  const { id, select } = useLocalSearchParams<{ id: string; select?: string }>();
  const { data: r, error, loading, reload } = useFocusQuery(() => requestCard({ id: Number(id) }));
  const { draft, start, setRequest } = useDraft();
  const [busy, setBusy] = useState(false);

  if (!r) {
    return (
      <Screen>
        {loading || error ? <StateView loading={loading} error={error} onRetry={reload} /> : <Text style={styles.meta}>Заявка не найдена</Text>}
      </Screen>
    );
  }

  // В выборе заявки при закрытии смены: та же заявка, сразу к выбору работы.
  const chooseForShift = () => {
    setRequest(r.number);
    router.replace('/shift/work');
  };

  // С главной: начать смену сегодняшней датой с этой заявкой (или добавить её в неотправленный черновик).
  async function addWork() {
    if (!r) return;
    if (draft && draft.workDate !== storeToday()) {
      const ok = await confirm(
        'Есть неотправленная смена',
        `${draft.editing ? 'Открыта правка смены' : 'Черновик'} за ${formatDate(draft.workDate)}. Добавить работы по заявке в неё?`,
        'Добавить',
      );
      if (!ok) return;
    }
    if (!draft) {
      setBusy(true);
      // Незаконченные заявки прошлых смен встают в начало списка, как при обычном закрытии смены.
      const carried = await myOpenRequests().catch(() => []);
      setBusy(false);
      start(storeToday(), carried);
    }
    setRequest(r.number);
    if (router.canDismiss()) router.dismissAll();
    router.push('/shift/list');
    router.push('/shift/work');
  }

  const who = r.to_contractor ? 'Подрядчик' : r.mine ? 'Вам' : r.assignee_name ?? 'Не назначена';

  return (
    <Screen>
      <TourTarget id="card.head">
        <View style={styles.head}>
          {r.mine ? <Text style={styles.badge}>Назначено вам</Text> : null}
          <Text style={styles.number} selectable>
            {r.number}
          </Text>
          {r.service || r.operation ? <Text style={styles.operation}>{[r.service, r.operation].filter(Boolean).join(' · ')}</Text> : null}
          <Text style={styles.meta}>
            {[r.registered_at ? formatRegistered(r.registered_at) : null, r.requester_name].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </TourTarget>

      <TourTarget id="card.text">
        <Card style={styles.card}>
          <Text style={styles.label}>Описание</Text>
          <Text style={styles.text} selectable>
            {r.description || r.subject || 'Без описания'}
          </Text>
          <Text style={styles.hint}>Номер или артикул можно скопировать: нажмите на текст и подержите.</Text>
        </Card>
      </TourTarget>

      <Card style={styles.card}>
        <View style={styles.line}>
          <Text style={styles.label}>Назначена</Text>
          <Text style={styles.value}>{who}</Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.label}>Исполнитель</Text>
          <Text style={styles.value}>{r.to_contractor ? 'Подрядчик' : 'Техники'}</Text>
        </View>
        {!r.is_open || r.state === 'done' ? <Text style={styles.closed}>{!r.is_open ? 'Заявка закрыта' : 'Отмечена выполненной'}</Text> : null}
      </Card>

      {r.works.length ? (
        <Card style={styles.card}>
          <Text style={styles.label}>Работы по заявке: {r.works.length}</Text>
          {r.works.map((w, i) => (
            <View key={i} style={[styles.work, i > 0 && styles.workBorder]}>
              <Text style={styles.workName}>{w.name}</Text>
              <Text style={styles.meta}>
                {formatDate(w.work_date)} · {formatQuantity(w.quantity)} {w.unit} · {w.performers ?? ''}
              </Text>
              <Text style={[styles.status, w.status === 'rejected' && styles.bad, w.status === 'pending' && styles.wait]}>{statusLabel[w.status]}</Text>
            </View>
          ))}
        </Card>
      ) : (
        <Text style={styles.meta}>Работ по заявке ещё не вносили.</Text>
      )}

      <TourTarget id="card.add">
        {select ? (
          <BigButton title="Выбрать эту заявку" size="big" onPress={chooseForShift} />
        ) : (
          <BigButton title="Внести работы по заявке" size="big" loading={busy} onPress={addWork} />
        )}
      </TourTarget>
      <BigButton title="Назад" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: 3 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brand,
    borderRadius: radius.chip,
    paddingHorizontal: 8,
    paddingVertical: 1,
    fontSize: font.small,
    fontWeight: '800',
    overflow: 'hidden',
  },
  number: { fontSize: font.title, fontWeight: '800' },
  operation: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
  card: { gap: 8 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  text: { fontSize: font.body + 1, lineHeight: 22 },
  hint: { fontSize: font.small - 1, color: colors.muted },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  value: { fontSize: font.body, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  closed: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
  work: { gap: 2, paddingTop: 6 },
  workBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  workName: { fontSize: font.body, fontWeight: '600' },
  status: { fontSize: font.small, fontWeight: '700', color: colors.success },
  bad: { color: colors.danger },
  wait: { color: colors.secondary },
});
