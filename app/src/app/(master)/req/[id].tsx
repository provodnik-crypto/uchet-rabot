import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { RequestBadges } from '../../../components/RequestBadges';
import { RequestFeed } from '../../../components/RequestFeed';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { useAuth } from '../../../lib/auth';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import {
  deleteMyWork,
  formatRegistered,
  holdText,
  lifecycleLabel,
  markRequestRead,
  refuseRequest,
  requestCard,
  requestLabel,
  requestPause,
  resumeRequest,
  takeRequest,
  type RequestWork,
} from '../../../lib/requests';
import { formatQuantity, listMasters } from '../../../lib/shift';
import { TourTarget } from '../../../lib/tour';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';
import { DueLine } from '../../../components/DueLine';

const workStatus: Record<RequestWork['status'], string> = {
  priced: 'Принято',
  pending: 'На оценке',
  rejected: 'Отклонено',
  awaiting: 'Ждёт приёмки',
};

/**
 * Карточка заявки — весь путь мастера: «Взять в работу» → «+ Добавить работу» (сразу сохраняется) →
 * «Отправить на проверку». Редкие действия (приостановить, отказаться) — в меню «⋯».
 */
export default function RequestCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const query = useFocusQuery(() => requestCard({ id: Number(id) }), { key: `card:${id}`, persist: false });
  const { data: r, error, loading, reload } = query;
  const [panel, setPanel] = useState<null | 'take' | 'refuse' | 'pause'>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Открыли карточку — сообщения прочитаны.
  useFocusEffect(useCallback(() => void markRequestRead(Number(id)), [id]));

  if (!r) {
    return (
      <Screen>
        {loading || error ? <StateView loading={loading} error={error} onRetry={reload} /> : <Text style={styles.meta}>Заявка не найдена</Text>}
      </Screen>
    );
  }

  const free = r.status === 'waiting' && r.is_open && !r.to_contractor && (!r.assignee_id || r.assignee_id === me?.id);
  // Правило: одна заявка в работе. Пока есть своя активная — другую не взять (смотреть и писать можно).
  const busyWith = r.my_active && r.my_active.id !== r.id ? r.my_active : null;
  const canTake = free && !busyWith;
  const paused = r.status === 'paused' && r.is_responsible;
  const working = r.status === 'in_work' && r.is_responsible;
  const isMember = r.members.some((m) => m.id === me?.id);
  const works = r.works;

  const addWork = () => router.push({ pathname: '/shift/work', params: { requestId: String(r.id), number: r.number } });

  /** Своя работа: исправить или удалить (пока заявка у мастера «В работе»). */
  function workMenu(w: RequestWork) {
    if (!w.can_edit || !w.id) return;
    const edit = () =>
      router.push({ pathname: '/shift/entry', params: { requestId: String(r!.id), entryId: String(w.id), work: JSON.stringify(w) } });
    const remove = async () => {
      if (!(await confirm('Удалить работу?', `${w.name}, ${formatQuantity(w.quantity)} ${w.unit}`, 'Удалить'))) return;
      setMessage(null);
      try {
        await deleteMyWork(w.id!);
        reload();
      } catch (e) {
        setMessage(humanError(e));
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Исправить работу? (Отмена — удалить)')) edit();
      else remove();
      return;
    }
    Alert.alert(w.name, undefined, [
      { text: 'Исправить', onPress: edit },
      { text: 'Удалить', style: 'destructive', onPress: remove },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }

  /** Меню «⋯»: редкие действия по заявке в работе. */
  function moreMenu() {
    const items: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (!r!.pause_request) items.push({ text: 'Приостановить', onPress: () => setPanel('pause') });
    items.push({ text: 'Отказаться от заявки', style: 'destructive', onPress: () => setPanel('refuse') });
    items.push({ text: 'Отмена', style: 'cancel' });
    if (Platform.OS === 'web') {
      setPanel(window.confirm('Приостановить? (Отмена — отказаться)') ? 'pause' : 'refuse');
      return;
    }
    Alert.alert('Ещё', undefined, items);
  }

  return (
    <Screen status={query}>
      <TourTarget id="card.head">
        <View style={styles.head}>
          <View style={styles.headRow}>
            <View style={styles.flex}>
              <RequestBadges status={r.status} priority={r.priority} contractor={r.to_contractor} mine={r.mine || r.is_responsible} />
            </View>
            {working ? (
              <TourTarget id="card.more">
                <Pressable accessibilityRole="button" accessibilityLabel="Ещё действия" hitSlop={10} onPress={moreMenu} style={styles.more}>
                  <Text style={styles.moreText}>⋯</Text>
                </Pressable>
              </TourTarget>
            ) : null}
          </View>
          <Text style={styles.number} selectable>
            {r.is_planned ? 'Работа без заявки · ' : ''}
            {requestLabel(r.number)}
          </Text>
          {r.service || r.operation ? <Text style={styles.operation}>{[r.service, r.operation].filter(Boolean).join(' · ')}</Text> : null}
          <Text style={styles.meta}>{[r.registered_at ? formatRegistered(r.registered_at) : null, r.requester_name].filter(Boolean).join(' · ')}</Text>
          <DueLine dueAt={r.due_at} status={r.status} isOpen={r.is_open} />
        </View>
      </TourTarget>

      {r.returned_comment && (r.status === 'in_work' || r.status === 'paused') ? (
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
        <Line label="Статус" value={(lifecycleLabel[r.status] ?? r.status) + (r.status === 'review' && r.sent_at ? ` с ${formatDate(r.sent_at.slice(0, 10))}` : '')} />
        {r.responsible_name ? <Line label="Взял" value={r.is_responsible ? 'Вы' : r.responsible_name} /> : null}
        {r.members.length ? <Line label="Напарники" value={r.members.map((m) => (m.id === me?.id ? 'вы' : m.name)).join(', ')} /> : null}
        {!r.responsible_name ? <Line label="Назначена" value={r.to_contractor ? 'Подрядчик' : r.assignee_id === me?.id ? 'Вам' : r.assignee_name ?? 'Не назначена'} /> : null}
        {!r.is_open ? <Text style={styles.closed}>Заявка закрыта</Text> : null}
        {isMember && !r.is_responsible ? <Text style={styles.hint}>Вы напарник: работы по заявке вносит {r.responsible_name}, сумма делится поровну.</Text> : null}
      </Card>

      {/* ---------- Занят другой заявкой / приостановлена ---------- */}
      {free && busyWith ? (
        <Card style={styles.busy}>
          <Text style={styles.busyTitle}>Сначала завершите {requestLabel(busyWith.number)}</Text>
          <Text style={styles.body}>Внесите работы и отправьте её на проверку — после этого можно взять эту.</Text>
          <BigButton title={`Открыть ${requestLabel(busyWith.number)}`} variant="secondary" onPress={() => router.push({ pathname: '/req/[id]', params: { id: String(busyWith.id) } })} />
        </Card>
      ) : null}
      {paused ? (
        <Card style={styles.busy}>
          <Text style={styles.busyTitle}>{holdText(r.hold_reason, r.hold_number)}</Text>
          {r.hold_reason === 'pause' ? (
            r.my_active ? (
              <Text style={styles.hint}>Продолжить можно, когда отправите {requestLabel(r.my_active.number)} на проверку.</Text>
            ) : (
              <BigButton
                title="Продолжить"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  setMessage(null);
                  try {
                    await resumeRequest(r.id);
                    reload();
                  } catch (e) {
                    setMessage(humanError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )
          ) : null}
        </Card>
      ) : null}
      {working && r.pause_request ? (
        <Card style={styles.busy}>
          <Text style={styles.busyTitle}>Запрос на приостановку у руководителя</Text>
          <Text style={styles.body}>{r.pause_request}</Text>
          <Text style={styles.hint}>Пока руководитель не решил, заявка остаётся у вас в работе.</Text>
        </Card>
      ) : null}

      {/* ---------- Взять в работу ---------- */}
      {canTake ? (
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

      {/* ---------- Работы ---------- */}
      {working ? (
        <TourTarget id="card.add">
          <BigButton title="+ Добавить работу" size="big" onPress={addWork} />
        </TourTarget>
      ) : null}
      {works.length ? (
        <Card style={styles.card}>
          <Text style={styles.label}>Работы по заявке: {works.length}</Text>
          {works.map((w, i) => (
            <Pressable
              key={w.id ?? i}
              disabled={!w.can_edit}
              onPress={() => workMenu(w)}
              accessibilityRole={w.can_edit ? 'button' : undefined}
              accessibilityHint={w.can_edit ? 'Исправить или удалить' : undefined}
              style={({ pressed }) => [styles.work, i > 0 && styles.workBorder, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.workName}>{w.name}</Text>
              <Text style={styles.meta}>
                {formatDate(w.work_date)} · {formatQuantity(w.quantity)} {w.unit} · {w.performers ?? ''}
              </Text>
              <Text style={[styles.status, w.status === 'rejected' && styles.bad, (w.status === 'pending' || w.status === 'awaiting') && styles.wait]}>
                {workStatus[w.status]}
                {w.can_edit ? ' · нажмите, чтобы исправить или удалить' : ''}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : (
        <Text style={styles.meta}>Работ по заявке ещё не вносили.</Text>
      )}

      {working ? (
        <>
          <TourTarget id="card.send">
            <BigButton
              title="Отправить на проверку"
              size="big"
              disabled={!works.length}
              onPress={() => router.push({ pathname: '/req/send/[id]', params: { id: String(r.id) } })}
            />
          </TourTarget>
          <Text style={styles.hint}>
            {works.length ? 'Сделали — отправьте. Не успели за день — ничего не делайте, продолжите завтра.' : 'Сначала добавьте хотя бы одну работу.'}
          </Text>
          {panel === 'pause' ? (
            <PausePanel
              requestId={r.id}
              onDone={() => {
                setPanel(null);
                reload();
              }}
              onCancel={() => setPanel(null)}
            />
          ) : null}
          {panel === 'refuse' ? (
            <RefusePanel
              requestId={r.id}
              onDone={() => {
                setPanel(null);
                reload();
              }}
              onCancel={() => setPanel(null)}
            />
          ) : null}
        </>
      ) : null}

      <RequestFeed requestId={r.id} events={r.events} onSent={reload} />

      {message ? <Text style={styles.err}>{message}</Text> : null}
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

/** «Взять в работу»: напарники (время не спрашиваем — с 22.10.2026 его не учитываем). */
function TakePanel({ requestId, meId, onDone, onCancel }: { requestId: number; meId: number; onDone: () => void; onCancel: () => void }) {
  const { data: masters } = useFocusQuery(listMasters);
  const [members, setMembers] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function take() {
    setSending(true);
    setErr(null);
    try {
      await takeRequest(requestId, null, members);
      onDone();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <Card style={styles.card}>
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
      <BigButton title="Взять" size="big" loading={sending} onPress={take} />
      <BigButton title="Отмена" variant="secondary" onPress={onCancel} />
    </Card>
  );
}

/** Отказ от заявки — с обязательным комментарием. */
/** «Приостановить»: только запрос руководителю с причиной; до решения заявка остаётся в работе. */
function PausePanel({ requestId, onDone, onCancel }: { requestId: number; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function send() {
    setSending(true);
    setErr(null);
    try {
      await requestPause(requestId, text.trim());
      onDone();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <Card style={styles.card}>
      <Field label="Почему заявка не может двигаться дальше?" value={text} onChangeText={setText} multiline placeholder="Например: ждём материалы, нет доступа, нужен подрядчик" />
      <Text style={styles.hint}>Запрос уйдёт руководителю. Пока он не подтвердил, заявка остаётся у вас в работе.</Text>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <BigButton title="Отправить запрос" loading={sending} disabled={text.trim().length < 3} onPress={send} />
      <BigButton title="Отмена" variant="secondary" onPress={onCancel} />
    </Card>
  );
}

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
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1 },
  more: { width: 44, height: 36, borderRadius: 18, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border },
  moreText: { fontSize: 22, fontWeight: '800', lineHeight: 24 },
  head: { gap: 3 },
  busy: { gap: 8, borderWidth: 2, borderColor: '#E65100' },
  busyTitle: { fontSize: font.body, fontWeight: '800', color: '#E65100' },
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
  err: { color: colors.danger, fontSize: font.body },
});
