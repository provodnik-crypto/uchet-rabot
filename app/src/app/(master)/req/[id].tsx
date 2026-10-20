import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { RequestBadges } from '../../../components/RequestBadges';
import { RequestFeed } from '../../../components/RequestFeed';
import { RequestTimeCard } from '../../../components/RequestTimeCard';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { useAuth } from '../../../lib/auth';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { withDraft } from '../../../lib/requestDraft';
import { useDraft } from '../../../lib/draft';
import { humanError } from '../../../lib/errors';
import {
  ESTIMATES,
  eventLabel,
  formatRegistered,
  lifecycleLabel,
  markRequestRead,
  refuseRequest,
  requestCard,
  takeRequest,
  type RequestWork, requestLabel } from '../../../lib/requests';
import { formatMinutes, formatPlan } from '../../../lib/requestTime';
import { formatQuantity, listMasters, myOpenRequests } from '../../../lib/shift';
import { returnToCardAfterEntry } from '../../../lib/shiftNav';
import { storeToday } from '../../../lib/today';
import { TourTarget } from '../../../lib/tour';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font, radius, touch } from '../../../theme';
import { DueLine } from '../../../components/DueLine';

const workStatus: Record<RequestWork['status'], string> = {
  priced: 'Принято',
  pending: 'На оценке',
  rejected: 'Отклонено',
  awaiting: 'Ждёт приёмки',
};

/** Карточка заявки: полный текст, статус, работы и время; действия по статусу. */
export default function RequestCardScreen() {
  const { id, select } = useLocalSearchParams<{ id: string; select?: string }>();
  const { me } = useAuth();
  const query = useFocusQuery(() => requestCard({ id: Number(id) }), { key: `card:${id}`, persist: false });
  const { data: r, error, loading, reload } = query;
  const { draft, start, setRequest, setRequestTime } = useDraft();
  const [panel, setPanel] = useState<null | 'take' | 'refuse'>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Вернулись в карточку — «после добавления работы вернуться сюда» больше не нужно.
  useFocusEffect(useCallback(() => returnToCardAfterEntry(null), []));
  // Открыли карточку — сообщения прочитаны.
  useFocusEffect(useCallback(() => void markRequestRead(Number(id)), [id]));

  if (!r) {
    return (
      <Screen>
        {loading || error ? <StateView loading={loading} error={error} onRetry={reload} /> : <Text style={styles.meta}>Заявка не найдена</Text>}
      </Screen>
    );
  }

  const today = storeToday();
  const canTake = r.status === 'waiting' && r.is_open && !r.to_contractor && (!r.assignee_id || r.assignee_id === me?.id);
  const working = r.status === 'in_work' && r.is_responsible;
  const isMember = r.members.some((m) => m.id === me?.id);
  // Сервер плюс смена на телефоне: черновик заменяет уже отправленную версию своего дня.
  const { works, draftEntries, draftTime, spent } = withDraft(r, draft);
  const over = r.plan_minutes != null && spent > r.plan_minutes;

  /** Черновик сегодняшнего дня: есть — используем (за другой день — спросим), нет — начинаем. */
  async function ensureDraft(): Promise<boolean> {
    if (draft) {
      if (draft.workDate === today) return true;
      return confirm(
        'Есть неотправленная смена',
        `${draft.editing ? 'Открыта правка смены' : 'Черновик'} за ${formatDate(draft.workDate)}. Внести в неё?`,
        'Внести',
      );
    }
    setBusy(true);
    // Мои заявки «В работе» встают в начало дня, как при обычном закрытии смены.
    const carried = await myOpenRequests().catch(() => []);
    setBusy(false);
    start(today, carried);
    return true;
  }

  async function addWork() {
    if (!r || !(await ensureDraft())) return;
    setRequest(r.number);
    returnToCardAfterEntry(r.id);
    router.push('/shift/work');
  }

  async function changeTime(minutes: number | null) {
    if (!r || !(await ensureDraft())) return;
    setRequestTime(r.number, { minutes });
  }

  const chooseForShift = () => {
    setRequest(r.number);
    router.replace('/shift/work');
  };

  return (
    <Screen status={query}>
      <TourTarget id="card.head">
        <View style={styles.head}>
          <RequestBadges status={r.status} priority={r.priority} contractor={r.to_contractor} mine={r.mine || r.is_responsible} />
          <Text style={styles.number} selectable>
            {requestLabel(r.number)}
          </Text>
          {r.service || r.operation ? <Text style={styles.operation}>{[r.service, r.operation].filter(Boolean).join(' · ')}</Text> : null}
          <Text style={styles.meta}>{[r.registered_at ? formatRegistered(r.registered_at) : null, r.requester_name].filter(Boolean).join(' · ')}</Text>
          <DueLine dueAt={r.due_at} status={r.status} isOpen={r.is_open} />
        </View>
      </TourTarget>

      {r.returned_comment && r.status === 'in_work' ? (
        <Card style={styles.returned}>
          <Text style={styles.returnedTitle}>Руководитель вернул заявку</Text>
          <Text style={styles.body}>{r.returned_comment}</Text>
        </Card>
      ) : null}

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
        <Line label="Статус" value={lifecycleLabel[r.status] + (r.status === 'review' && r.sent_at ? ` с ${formatDate(r.sent_at.slice(0, 10))}` : '')} />
        {r.responsible_name ? <Line label="Взял" value={r.is_responsible ? 'Вы' : r.responsible_name} /> : null}
        {r.members.length ? <Line label="Напарники" value={r.members.map((m) => (m.id === me?.id ? 'вы' : m.name)).join(', ')} /> : null}
        {!r.responsible_name ? <Line label="Назначена" value={r.to_contractor ? 'Подрядчик' : r.assignee_id === me?.id ? 'Вам' : r.assignee_name ?? 'Не назначена'} /> : null}
        <Line label="Исполнитель" value={r.to_contractor ? 'Подрядчик' : 'Техники'} />
        {r.plan_minutes != null || spent > 0 ? (
          <Line label="Время" value={`${formatMinutes(spent)}${r.plan_minutes != null ? ` из ~${formatPlan(r.plan_minutes)}` : ''}`} warn={over} />
        ) : null}
        {!r.is_open ? <Text style={styles.closed}>Заявка закрыта</Text> : null}
        {isMember && !r.is_responsible ? <Text style={styles.hint}>Вы напарник: работы по заявке вносит {r.responsible_name}, сумма делится поровну.</Text> : null}
      </Card>

      {/* ---------- Взять в работу ---------- */}
      {canTake && !select ? (
        panel === 'take' ? (
          <TakePanel
            requestId={r.id}
            meId={me?.id ?? 0}
            onDone={() => {
              setPanel(null);
              reload();
            }}
            onCancel={() => setPanel(null)}
          />
        ) : (
          <TourTarget id="card.take">
            <BigButton title="Взять в работу" size="big" onPress={() => setPanel('take')} />
          </TourTarget>
        )
      ) : null}

      {/* ---------- Работа над заявкой ---------- */}
      {working && !select ? (
        <>
          <TourTarget id="card.add">
            <BigButton title="+ Добавить работу" size="big" loading={busy} onPress={addWork} />
          </TourTarget>
          <TourTarget id="card.time">
            <RequestTimeCard
              label="Время за сегодня"
              time={draftTime ?? { number: r.number, minutes: null, status: 'done' }}
              onChange={(p) => changeTime(p.minutes ?? null)}
            />
          </TourTarget>
        </>
      ) : null}

      {works.length || draftEntries.length ? (
        <Card style={styles.card}>
          <Text style={styles.label}>Работы по заявке: {works.length + draftEntries.length}</Text>
          {draftEntries.map((e, i) => (
            <View key={e.key} style={[styles.work, i > 0 && styles.workBorder]}>
              <Text style={styles.workName}>{e.name}</Text>
              <Text style={styles.meta}>
                {formatDate(draft!.workDate)} · {e.quantity} {e.unitCode} · {e.performerNames.join(', ')}
              </Text>
              <Text style={[styles.status, styles.wait]}>{draft!.editing ? 'Правка дня — уйдёт при отправке' : 'Ещё не отправлено'}</Text>
            </View>
          ))}
          {works.map((w, i) => (
            <View key={i} style={[styles.work, (i > 0 || draftEntries.length > 0) && styles.workBorder]}>
              <Text style={styles.workName}>{w.name}</Text>
              <Text style={styles.meta}>
                {formatDate(w.work_date)} · {formatQuantity(w.quantity)} {w.unit} · {w.performers ?? ''}
              </Text>
              <Text style={[styles.status, w.status === 'rejected' && styles.bad, (w.status === 'pending' || w.status === 'awaiting') && styles.wait]}>
                {workStatus[w.status]}
              </Text>
            </View>
          ))}
        </Card>
      ) : (
        <Text style={styles.meta}>Работ по заявке ещё не вносили.</Text>
      )}

      {working && !select ? (
        <>
          <TourTarget id="card.send">
            <BigButton title="Проверить и отправить" size="big" onPress={() => router.push({ pathname: '/req/send/[id]', params: { id: String(r.id) } })} />
          </TourTarget>
          <Text style={styles.hint}>Отправляйте, когда заявка сделана. Не успели за день — ничего не делайте, завтра она будет в «Мои заявки».</Text>
          {panel === 'refuse' ? (
            <RefusePanel
              requestId={r.id}
              onDone={() => {
                setPanel(null);
                reload();
              }}
              onCancel={() => setPanel(null)}
            />
          ) : (
            <BigButton title="Отказаться от заявки" variant="secondary" onPress={() => setPanel('refuse')} />
          )}
        </>
      ) : null}

      {select ? (
        canTake || working ? (
          <BigButton title="Выбрать эту заявку" size="big" onPress={chooseForShift} />
        ) : (
          <Text style={styles.hint}>
            {r.status === 'in_work' ? `Заявку взял ${r.responsible_name}.` : `Заявка: ${lifecycleLabel[r.status].toLowerCase()}.`} Выбрать её для своей смены нельзя.
          </Text>
        )
      ) : null}

      {r ? <RequestFeed requestId={r.id} events={r.events} onSent={reload} /> : null}

      {message ? <Text style={styles.err}>{message}</Text> : null}
      <BigButton title="Назад" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );

}

function Line({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, warn && { color: colors.danger }]}>{value}</Text>
    </View>
  );
}

/** «Взять в работу»: примерное время и напарники. */
function TakePanel({ requestId, meId, onDone, onCancel }: { requestId: number; meId: number; onDone: () => void; onCancel: () => void }) {
  const { data: masters } = useFocusQuery(listMasters);
  const [plan, setPlan] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [members, setMembers] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const step = (d: number) => setPlan((p) => Math.max(30, (p ?? 60) + d));
  async function take() {
    setSending(true);
    setErr(null);
    try {
      await takeRequest(requestId, plan, members);
      onDone();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <Card style={styles.card}>
      <Text style={styles.h}>Сколько примерно займёт?</Text>
      <View style={styles.chips}>
        {ESTIMATES.map((e) => (
          <Chip key={e.label} label={e.label} selected={!custom && plan === e.minutes} onPress={() => (setCustom(false), setPlan(e.minutes))} />
        ))}
        <Chip label="Свой вариант" selected={custom} onPress={() => (setCustom(true), setPlan((p) => p ?? 60))} />
      </View>
      {custom ? (
        <View style={styles.stepper}>
          <Pressable accessibilityRole="button" accessibilityLabel="Меньше на 30 минут" style={styles.stepBtn} onPress={() => step(-30)}>
            <Text style={styles.stepText}>−30</Text>
          </Pressable>
          <Text style={styles.stepValue}>{plan != null ? formatPlan(plan) : '—'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Больше на 30 минут" style={styles.stepBtn} onPress={() => step(30)}>
            <Text style={styles.stepText}>+30</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.h}>Напарники (если работаете вместе)</Text>
      <View style={styles.chips}>
        {(masters ?? [])
          .filter((m) => m.id !== meId)
          .map((m) => (
            <Chip
              key={m.id}
              label={m.display_name}
              selected={members.includes(m.id)}
              onPress={() => setMembers((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))}
            />
          ))}
      </View>
      <Text style={styles.hint}>Напарники числятся в заявке, сумма по её работам делится поровну. Работы вносите вы.</Text>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <BigButton title="Взять" size="big" loading={sending} disabled={plan == null} onPress={take} />
      {plan == null ? <Text style={styles.hint}>Выберите примерное время.</Text> : null}
      <BigButton title="Отмена" variant="secondary" onPress={onCancel} />
    </Card>
  );
}

/** Отказ от заявки — с обязательным комментарием. */
function RefusePanel({ requestId, onDone, onCancel }: { requestId: number; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function refuse() {
    setSending(true);
    setErr(null);
    try {
      await refuseRequest(requestId, text.trim());
      onDone();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <Card style={styles.card}>
      <Field label="Почему отказываетесь?" value={text} onChangeText={setText} multiline placeholder="Например: нет запчасти, нужен подрядчик" />
      <Text style={styles.hint}>Заявка снова станет «Ожидает», руководитель увидит ваш комментарий.</Text>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <BigButton title="Отказаться" variant="danger" loading={sending} disabled={text.trim().length < 3} onPress={refuse} />
      <BigButton title="Отмена" variant="secondary" onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { gap: 3 },
  number: { fontSize: font.title, fontWeight: '800' },
  operation: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
  body: { fontSize: font.body },
  card: { gap: 8 },
  h: { fontSize: font.body, fontWeight: '700' },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  text: { fontSize: font.body + 1, lineHeight: 22 },
  hint: { fontSize: font.small - 1, color: colors.muted },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  value: { fontSize: font.body, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  closed: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
  returned: { gap: 4, borderWidth: 2, borderColor: colors.danger },
  returnedTitle: { fontSize: font.body, fontWeight: '800', color: colors.danger },
  work: { gap: 2, paddingTop: 6 },
  workBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  workName: { fontSize: font.body, fontWeight: '600' },
  status: { fontSize: font.small, fontWeight: '700', color: colors.success },
  bad: { color: colors.danger },
  wait: { color: colors.secondary },
  event: { fontSize: font.small, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: touch.min + 8,
    height: touch.min,
    borderRadius: radius.control,
    borderWidth: 2,
    borderColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: font.body, fontWeight: '800' },
  stepValue: { flex: 1, textAlign: 'center', fontSize: font.title, fontWeight: '800' },
  err: { color: colors.danger, fontSize: font.body },
});
