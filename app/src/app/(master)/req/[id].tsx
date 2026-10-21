import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActionSheet, type SheetAction } from '../../../components/ActionSheet';
import { AppHeader, IconButton } from '../../../components/AppHeader';
import { BigButton } from '../../../components/BigButton';
import { Chip } from '../../../components/Chip';
import { DueLine } from '../../../components/DueLine';
import { Field } from '../../../components/Field';
import { RequestFeed } from '../../../components/RequestFeed';
import { Screen } from '../../../components/Screen';
import { Section } from '../../../components/Section';
import { StateView } from '../../../components/StateView';
import { PriorityPill, requestTone, StatusPill } from '../../../components/StatusPill';
import { Text } from '../../../components/Text';
import { useAuth } from '../../../lib/auth';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import {
  deleteMyWork,
  formatRegistered,
  holdText,
  markRequestRead,
  refuseRequest,
  requestCard,
  cantDo,
  type CantDoReason,
  requestLabel,
  requestPause,
  resumeRequest,
  takeRequest,
  type RequestWork,
} from '../../../lib/requests';
import { formatQuantity, listMasters } from '../../../lib/shift';
import { storeToday } from '../../../lib/today';
import { TourTarget } from '../../../lib/tour';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font, lineHeight, opacity, radius, space, stroke } from '../../../theme';

const workStatus: Record<RequestWork['status'], string> = {
  priced: 'Принято',
  pending: 'На оценке',
  rejected: 'Отклонено',
  awaiting: 'Ждёт приёмки',
};

type Panel = null | 'take' | 'refuse' | 'pause' | 'cant';

/** «N-й день» с даты взятия (по календарю магазина). */
function dayNumber(takenAt: string | null): number | null {
  if (!takenAt) return null;
  const n = Math.round((Date.parse(storeToday()) - Date.parse(takenAt.slice(0, 10))) / 86_400_000) + 1;
  return Number.isFinite(n) ? Math.max(1, n) : null;
}

/**
 * Карточка заявки — весь путь мастера: «Взять в работу» → «+ Добавить работу» (сразу сохраняется) →
 * «Отправить на проверку» (кнопка закреплена внизу). Редкие действия — в меню «⋯»:
 * приостановить, отказаться, передать подрядчику (просьба руководителю).
 */
export default function RequestCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const query = useFocusQuery(() => requestCard({ id: Number(id) }), { key: `card:${id}`, persist: false });
  const { data: r, error, loading, reload } = query;
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  const [workFor, setWorkFor] = useState<RequestWork | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Открыли карточку — сообщения прочитаны.
  useFocusEffect(useCallback(() => void markRequestRead(Number(id)), [id]));

  if (!r) {
    return (
      <Screen header={<AppHeader title="Заявка" back />}>
        {loading || error ? <StateView loading={loading} error={error} onRetry={reload} /> : <Text style={styles.meta}>Заявка не найдена</Text>}
      </Screen>
    );
  }

  const free = r.status === 'waiting' && r.is_open && !r.to_contractor && (!r.assignee_id || r.assignee_id === me?.id);
  // Правило: одна заявка в работе. Пока есть своя активная — другую не взять (смотреть и писать можно).
  const busyWith = r.my_active && r.my_active.id !== r.id ? r.my_active : null;
  const canTake = free && !busyWith;
  // закрытая заявка — только для просмотра
  const paused = r.status === 'paused' && r.is_responsible && r.is_open;
  const working = r.status === 'in_work' && r.is_responsible && r.is_open;
  const isMember = r.members.some((m) => m.id === me?.id);
  const works = r.works;
  // отклонённые работы не в счёт: отправить на проверку можно, только если есть другие
  const liveWorks = works.filter((w) => w.status !== 'rejected').length;
  const returned = !!r.returned_comment && (r.status === 'in_work' || r.status === 'paused');
  const day = r.status === 'in_work' ? dayNumber(r.taken_at) : null;
  const tone = requestTone({
    status: r.status,
    returned,
    contractor: r.to_contractor,
    busyName: r.status === 'in_work' && !r.is_responsible && !isMember ? r.responsible_name : null,
    hold: r.hold_reason,
  });

  const addWork = () => router.push({ pathname: '/shift/work', params: { requestId: String(r.id), number: r.number } });
  const send = () => router.push({ pathname: '/req/send/[id]', params: { id: String(r.id) } });
  const done = () => {
    setPanel(null);
    reload();
  };

  /** Своя работа: исправить или удалить (пока заявка у мастера «В работе»). */
  const workActions: SheetAction[] = workFor?.id
    ? [
        {
          label: 'Исправить',
          onPress: () => router.push({ pathname: '/shift/entry', params: { requestId: String(r.id), entryId: String(workFor.id), work: JSON.stringify(workFor) } }),
        },
        {
          label: 'Удалить',
          danger: true,
          onPress: async () => {
            const w = workFor;
            if (!(await confirm('Удалить работу?', `${w.name}, ${formatQuantity(w.quantity)} ${w.unit}`, 'Удалить'))) return;
            setMessage(null);
            try {
              await deleteMyWork(w.id!);
              reload();
            } catch (e) {
              setMessage(humanError(e));
            }
          },
        },
      ]
    : [];

  /** Меню «⋯»: редкие действия по своей заявке в работе. */
  const moreActions: SheetAction[] = [
    ...(r.pause_request ? [] : [{ label: 'Приостановить', hint: 'Запрос руководителю с причиной', onPress: () => setPanel('pause') }]),
    { label: 'Не могу выполнить', hint: 'Нет материалов, заявка не нужна или нужен подрядчик', onPress: () => setPanel('cant') },
    { label: 'Отказаться от заявки', danger: true, onPress: () => setPanel('refuse') },
  ];

  /** Главная кнопка внизу — по статусу. */
  let footer: React.ReactNode = null;
  if (!panel) {
    if (canTake)
      footer = (
        <TourTarget id="card.take">
          <BigButton title="Взять в работу" size="big" onPress={() => setPanel('take')} />
        </TourTarget>
      );
    else if (working)
      footer = (
        <TourTarget id="card.send">
          <BigButton title={returned ? 'Исправить и отправить' : 'Отправить на проверку'} size="big" disabled={!liveWorks} onPress={send} />
        </TourTarget>
      );
    else if (paused && (r.hold_reason === 'pause' || r.hold_reason === 'materials') && !r.my_active)
      footer = (
        <BigButton
          title="Продолжить"
          size="big"
          variant="dark"
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
      );
  }

  return (
    <Screen
      status={query}
      footer={footer}
      header={
        <AppHeader
          title={`${r.is_planned ? 'Без заявки · ' : ''}${requestLabel(r.number)}`}
          back
          right={
            working ? (
              <TourTarget id="card.more">
                <IconButton icon="more" label="Ещё: приостановить, не могу выполнить, отказаться" onPress={() => setMenu(true)} />
              </TourTarget>
            ) : null
          }
        />
      }
    >
      <ActionSheet visible={menu} title="Редкие действия" actions={moreActions} onClose={() => setMenu(false)} />
      <ActionSheet visible={!!workFor} title={workFor ? `${workFor.name}, ${formatQuantity(workFor.quantity)} ${workFor.unit}` : undefined} actions={workActions} onClose={() => setWorkFor(null)} />

      {/* ---------- Статус и текст ---------- */}
      <TourTarget id="card.head">
        <Section>
          <View style={styles.pills}>
            <StatusPill tone={tone.tone} label={day && tone.tone === 'in_work' ? `В работе · ${day}-й день` : tone.label} />
            <PriorityPill priority={r.priority} />
            {r.operation || r.service ? <StatusPill tone="waiting" label={r.operation || r.service || ''} /> : null}
          </View>
          <TourTarget id="card.text">
            <Text style={styles.text} selectable>
              {r.description || r.subject || 'Без описания'}
            </Text>
          </TourTarget>
          <Text style={styles.meta}>
            {[r.requester_name, r.registered_at ? formatRegistered(r.registered_at) : null].filter(Boolean).join(' · ')}
          </Text>
          <DueLine dueAt={r.due_at} status={r.status} isOpen={r.is_open} />
          <Text style={styles.meta}>
            {[
              r.responsible_name ? `Взял: ${r.is_responsible ? 'вы' : r.responsible_name}` : null,
              r.members.length ? `напарники: ${r.members.map((m) => (m.id === me?.id ? 'вы' : m.name)).join(', ')}` : null,
              !r.responsible_name ? `назначена: ${r.to_contractor ? 'подрядчик' : r.assignee_id === me?.id ? 'вам' : r.assignee_name ?? 'никому'}` : null,
              r.status === 'review' && r.sent_at ? `на проверке с ${formatDate(r.sent_at.slice(0, 10))}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {!r.is_open ? <Text style={styles.red}>Заявка закрыта</Text> : null}
          {isMember && !r.is_responsible ? <Text style={styles.meta}>Вы напарник: работы вносит {r.responsible_name}, сумма делится поровну.</Text> : null}
        </Section>
      </TourTarget>

      {returned ? (
        <View style={[styles.plate, styles.plateRed]}>
          <Text style={[styles.plateTitle, styles.red]}>Руководитель вернул заявку</Text>
          <Text style={styles.body}>{r.returned_comment}</Text>
        </View>
      ) : null}

      {/* ---------- Занят другой заявкой / приостановлена / запрос ---------- */}
      {free && busyWith ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/req/[id]', params: { id: String(busyWith.id) } })}
          style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
        >
          <Text style={styles.bannerText}>
            У вас в работе <Text style={styles.bold}>{requestLabel(busyWith.number)}</Text>. Эту можно взять после отправки той на проверку.
          </Text>
        </Pressable>
      ) : null}
      {paused ? (
        <View style={styles.plate}>
          <Text style={styles.plateTitle}>{holdText(r.hold_reason, r.hold_number)}</Text>
          {r.hold_reason === 'materials' ? (
            <Text style={styles.meta}>Вы свободны — можно брать другие заявки. Пришли материалы — нажмите «Продолжить».</Text>
          ) : null}
          {(r.hold_reason === 'pause' || r.hold_reason === 'materials') && r.my_active ? (
            <Text style={styles.meta}>Продолжить можно, когда отправите {requestLabel(r.my_active.number)} на проверку.</Text>
          ) : null}
        </View>
      ) : null}
      {working && r.pause_request ? (
        <View style={styles.plate}>
          <Text style={styles.plateTitle}>Запрос на приостановку у руководителя</Text>
          <Text style={styles.body}>{r.pause_request}</Text>
          <Text style={styles.meta}>Пока руководитель не решил, заявка остаётся у вас в работе.</Text>
        </View>
      ) : null}

      {/* ---------- Панели действий ---------- */}
      {panel === 'take' ? <TakePanel requestId={r.id} meId={me?.id ?? 0} onDone={done} onCancel={() => setPanel(null)} /> : null}
      {panel === 'pause' ? (
        <ReasonPanel
          label="Почему заявка не может двигаться дальше?"
          placeholder="Например: ждём материалы, нет доступа"
          hint="Запрос уйдёт руководителю. Пока он не подтвердил, заявка остаётся у вас в работе."
          button="Отправить запрос"
          run={(t) => requestPause(r.id, t)}
          onDone={done}
          onCancel={() => setPanel(null)}
        />
      ) : null}
      {panel === 'cant' ? (
        <CantDoPanel
          requestId={r.id}
          onDone={(msg) => {
            setMessage(msg);
            done();
          }}
          onCancel={() => setPanel(null)}
        />
      ) : null}
      {panel === 'refuse' ? (
        <ReasonPanel
          label="Почему отказываетесь?"
          placeholder="Например: нет запчасти"
          hint={`Заявка снова станет «Ожидает», руководитель увидит ваш комментарий.${
            liveWorks ? ` Ваши работы по заявке (${liveWorks}) будут удалены — их не получит следующий мастер.` : ''
          }`}
          button="Отказаться"
          danger
          run={(t) => refuseRequest(r.id, t)}
          onDone={done}
          onCancel={() => setPanel(null)}
        />
      ) : null}

      {/* ---------- Работы ---------- */}
      {works.length || working ? (
        <Section title={`Работы по заявке${works.length ? ` · ${works.length}` : ''}`}>
          {works.map((w, i) => (
            <Pressable
              key={w.id ?? i}
              disabled={!w.can_edit || !w.id}
              onPress={() => setWorkFor(w)}
              accessibilityRole={w.can_edit ? 'button' : undefined}
              accessibilityHint={w.can_edit ? 'Исправить или удалить' : undefined}
              style={({ pressed }) => [styles.work, i > 0 && styles.workLine, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text style={styles.body}>{w.name}</Text>
                <Text style={styles.small}>
                  {formatDate(w.work_date)}
                  {w.performers ? ` · ${w.performers}` : ''} ·{' '}
                  <Text style={[w.status === 'rejected' && styles.red, w.status === 'priced' && styles.green]}>{workStatus[w.status]}</Text>
                </Text>
              </View>
              <Text style={styles.qty}>
                {formatQuantity(w.quantity)} {w.unit}
              </Text>
            </Pressable>
          ))}
          {!works.length ? <Text style={styles.meta}>Работ ещё нет. Добавьте всё, что сделали.</Text> : null}
          {works.some((w) => w.can_edit) ? <Text style={styles.small}>Нажмите на свою работу, чтобы исправить или удалить.</Text> : null}
          {working ? (
            <TourTarget id="card.add">
              <BigButton title="+ Добавить работу" variant="secondary" size="mid" onPress={addWork} />
            </TourTarget>
          ) : null}
          {working && !liveWorks ? <Text style={styles.small}>Отправить на проверку можно, когда есть хотя бы одна работа (отклонённые не в счёт).</Text> : null}
        </Section>
      ) : null}

      {message ? <Text style={styles.note}>{message}</Text> : null}

      <RequestFeed requestId={r.id} events={r.events} onSent={reload} />
    </Screen>
  );
}

/** «Взять в работу»: напарники (если работаете вместе). */
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
    <Section title="Взять в работу">
      <Text style={styles.body}>Напарники (если работаете вместе)</Text>
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
      <Text style={styles.small}>Напарники числятся в заявке, сумма по её работам делится поровну. Работы вносите вы.</Text>
      {err ? <Text style={styles.red}>{err}</Text> : null}
      <BigButton title="Взять" size="big" loading={sending} onPress={take} />
      <BigButton title="Отмена" variant="secondary" onPress={onCancel} />
    </Section>
  );
}

const CANT_DO: { value: CantDoReason; label: string; hint: string; placeholder: string; done: string }[] = [
  {
    value: 'materials',
    label: 'Нет материалов',
    hint: 'Заявка сразу встанет «Ждёт материалы», вы сможете брать другие. Пришли материалы — «Продолжить».',
    placeholder: 'Каких материалов нет, например: краска RAL 9016, 2 л',
    done: 'Заявка ждёт материалы — можно брать другую.',
  },
  {
    value: 'not_needed',
    label: 'Заявка не нужна',
    hint: 'Просьба закрыть уйдёт руководителю — закрывает только он. Пока он не решил, заявка у вас в работе.',
    placeholder: 'Почему не нужна, например: телевизора нет, заявка старая',
    done: 'Просьба закрыть заявку отправлена руководителю.',
  },
  {
    value: 'contractor',
    label: 'Нужен подрядчик',
    hint: 'Просьба передать подрядчику уйдёт руководителю. Пока он не решил, заявка у вас в работе.',
    placeholder: 'Почему нужен подрядчик, например: нужна вышка',
    done: 'Просьба передать подрядчику отправлена руководителю.',
  },
];

/** «Не могу выполнить»: причина (обязательно) и комментарий почему (обязательно). Работы и фото не нужны. */
function CantDoPanel({ requestId, onDone, onCancel }: { requestId: number; onDone: (message: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<CantDoReason | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const opt = CANT_DO.find((o) => o.value === reason);
  async function go() {
    if (!opt) return;
    setSending(true);
    setErr(null);
    try {
      await cantDo(requestId, opt.value, text.trim());
      onDone(opt.done);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <Section title="Не могу выполнить">
      <Text style={styles.body}>Причина</Text>
      <View style={styles.chips}>
        {CANT_DO.map((o) => (
          <Chip key={o.value} label={o.label} selected={reason === o.value} onPress={() => setReason(o.value)} />
        ))}
      </View>
      {opt ? (
        <>
          <Field label="Почему — обязательно" value={text} onChangeText={setText} multiline placeholder={opt.placeholder} />
          <Text style={styles.small}>{opt.hint}</Text>
        </>
      ) : (
        <Text style={styles.small}>Выберите причину.</Text>
      )}
      {err ? <Text style={styles.red}>{err}</Text> : null}
      <BigButton title="Отправить" size="mid" loading={sending} disabled={!opt || text.trim().length < 3} onPress={go} />
      <BigButton title="Отмена" variant="secondary" onPress={onCancel} />
    </Section>
  );
}

/** Действие с обязательной причиной: приостановить, отказаться. */
function ReasonPanel({
  label,
  placeholder,
  hint,
  button,
  danger,
  run,
  onDone,
  onCancel,
}: {
  label: string;
  placeholder: string;
  hint: string;
  button: string;
  danger?: boolean;
  run: (text: string) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function go() {
    setSending(true);
    setErr(null);
    try {
      await run(text.trim());
      onDone();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <Section>
      <Field label={label} value={text} onChangeText={setText} multiline placeholder={placeholder} />
      <Text style={styles.small}>{hint}</Text>
      {err ? <Text style={styles.red}>{err}</Text> : null}
      <BigButton title={button} variant={danger ? 'danger' : 'primary'} size="mid" loading={sending} disabled={text.trim().length < 3} onPress={go} />
      <BigButton title="Отмена" variant="secondary" onPress={onCancel} />
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: space.s2 },
  pressed: { opacity: opacity.pressed },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s6 },
  text: { fontSize: font.text, lineHeight: lineHeight.text },
  body: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.secondary },
  small: { fontSize: font.caption, color: colors.secondary },
  qty: { fontSize: font.body, fontWeight: '700' },
  red: { color: colors.danger, fontWeight: '700' },
  green: { color: colors.success, fontWeight: '700' },
  bold: { fontWeight: '700' },
  note: { fontSize: font.small, fontWeight: '700' },
  plate: { backgroundColor: colors.note, borderRadius: radius.control, padding: space.s14, gap: space.s6 },
  plateRed: { backgroundColor: colors.dangerBg },
  plateTitle: { fontSize: font.body, fontWeight: '700' },
  banner: { backgroundColor: colors.black, borderRadius: radius.control, paddingVertical: space.s12, paddingHorizontal: space.s14 },
  bannerText: { fontSize: font.small, color: colors.onDark, lineHeight: lineHeight.small },
  work: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s12, paddingVertical: space.s10 },
  workLine: { borderTopWidth: stroke.hair, borderTopColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s6 },
});
