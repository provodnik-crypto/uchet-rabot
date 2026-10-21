import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { RequestFeed } from '../../../components/RequestFeed';
import { WorksMoney } from '../../../components/WorksMoney';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { requestRow, setManualRequestTitle, updateRequest, type RequestRow } from '../../../lib/manager';
import {
  assignRequest,
  formatRegistered,
  lifecycleLabel,
  priorityLabel,
  markRequestRead,
  requestCard,
  setRequestOpen,
  setRequestPriority,
  setRequestResponsible,
  type Priority, requestLabel, decidePause, holdText, resumeRequest } from '../../../lib/requests';
import { listMasters } from '../../../lib/shift';
import { useFocusQuery } from '../../../lib/useQuery';
import { TourTarget } from '../../../lib/tour';
import { colors, font, radius, space, stroke } from '../../../theme';
import { DueLine } from '../../../components/DueLine';
import { settleBeforeLeaving } from '../../../lib/settle';


/** Открывается из списка (данные строки в параметрах) или по номеру — из уведомлений на главной. */
export default function RequestScreen() {
  const { data, id, number } = useLocalSearchParams<{ id: string; data?: string; number?: string }>();
  // строка заявки всегда свежая (по id); снимок из списка — только чтобы сразу что-то показать
  const snapshot = data ? (JSON.parse(data) as RequestRow) : null;
  const { data: fresh, error, loading, reload } = useFocusQuery(() => requestRow(Number(id)), { key: `reqrow:${id}`, persist: false });
  const row = fresh ?? (snapshot && snapshot.id === Number(id) ? snapshot : null);
  void number;
  if (!row) {
    return (
      <Screen>
        {loading || error ? <StateView loading={loading} error={error} onRetry={reload} /> : <Text style={styles.meta}>Заявка не найдена</Text>}
      </Screen>
    );
  }
  return <RequestDetail r={row} />;
}

function RequestDetail({ r }: { r: RequestRow }) {
  const [subject, setSubject] = useState(r.subject ?? '');
  const cardQ = useFocusQuery(() => requestCard({ id: r.id }), { key: `card:${r.id}`, persist: false });
  const { data: card, reload: reloadCard } = cardQ;
  useFocusEffect(useCallback(() => void markRequestRead(r.id), [r.id]));
  const { data: masters } = useFocusQuery(listMasters);
  const [assignee, setAssignee] = useState<number | null>(r.assignee_id);
  const [contractor, setContractor] = useState(r.to_contractor);
  const [isOpen, setIsOpen] = useState(r.is_open);
  // после любых действий карточка перечитывается — назначение и «закрыта» берём из неё
  useEffect(() => {
    if (!card) return;
    setAssignee(card.assignee_id);
    setContractor(card.to_contractor);
    setIsOpen(card.is_open);
  }, [card]);
  const itsm = r.source === 'itsm';
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rejectText, setRejectText] = useState('');

  async function save() {
    setBusy('save');
    setMessage(null);
    try {
      if (r.source === 'manual') await setManualRequestTitle(r.id, subject.trim());
      else await updateRequest(r.id, { subject: subject.trim() || null });
      router.back();
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setBusy(null);
    }
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setBusy(null);
    }
  }

  const assign = async (employeeId: number | null, toContractor: boolean) => {
    if (busy) return;
    // случайное касание чипа не должно сразу отдавать заявку подрядчику или снимать назначение
    if (toContractor && !contractor) {
      const atMaster = card && (card.status === 'in_work' || card.status === 'paused') ? card.responsible_name : null;
      if (!(await confirm('Передать подрядчику?', atMaster ? `Заявка уйдёт от мастера ${atMaster}.` : 'Мастера перестанут её видеть как свободную.', 'Передать'))) return;
    }
    if (!toContractor && employeeId === null && (assignee || contractor)) {
      if (!(await confirm('Снять назначение?', 'Заявка станет свободной для всех мастеров.', 'Снять'))) return;
    }
    return run('assign', async () => {
      if (toContractor && !(await settleBeforeLeaving(r.id, 'Передать подрядчику', card))) return;
      await assignRequest(r.id, employeeId, toContractor);
      setAssignee(employeeId);
      setContractor(toContractor);
      reloadCard();
    });
  };

  async function toggleOpen() {
    const atMaster = card && (card.status === 'in_work' || card.status === 'paused') ? card.responsible_name : null;
    const text = atMaster
      ? `Заявка сейчас у мастера ${atMaster} — она будет снята с него, и он сможет взять другую. Мастера перестанут видеть её в списке.`
      : 'Мастера перестанут видеть её в списке заявок.';
    if (isOpen && !(await confirm('Закрыть заявку?', text, 'Закрыть'))) return;
    run('open', async () => {
      if (isOpen && !(await settleBeforeLeaving(r.id, 'Закрыть заявку', card))) return;
      await setRequestOpen(r.id, !isOpen);
      setIsOpen(!isOpen);
      reloadCard();
    });
  }

  return (
    <Screen status={cardQ} frame>
      <Text style={styles.number}>{requestLabel(r.number)}</Text>
      <Text style={styles.meta}>
        Работ по заявке: {r.entries}
        {r.since ? ` · в работе с ${formatDate(r.since)}` : ''}
        {r.carries ? ` · переносов: ${r.carries}` : ''}
      </Text>

      {itsm ? (
        <Card style={styles.card}>
          <Text style={styles.meta}>{[r.service, r.operation].filter(Boolean).join(' · ')}</Text>
          {r.description ? <Text style={styles.body}>{r.description}</Text> : null}
          <Text style={styles.meta}>
            {formatRegistered(r.registered_at)} · {r.requester ?? 'заявитель не указан'}
            {r.itsm_status ? ` · ${r.itsm_status}` : ''}
          </Text>
          <DueLine dueAt={r.due_at} status={r.status} isOpen={isOpen} />
          {!isOpen ? <Text style={styles.closed}>Закрыта</Text> : null}
        </Card>
      ) : null}

      {isOpen && (!card || card.status === 'waiting' || card.status === 'contractor' || card.status === 'in_work' || card.status === 'paused') ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Кому назначена</Text>
          <View style={styles.chips}>
            <Chip label="Никому" selected={!assignee && !contractor} onPress={() => assign(null, false)} />
            {(masters ?? []).map((m) => (
              <Chip key={m.id} label={m.display_name} selected={assignee === m.id} onPress={() => assign(m.id, false)} />
            ))}
            <Chip label="Подрядчик" selected={contractor} onPress={() => assign(null, true)} />
          </View>
          <Text style={styles.hint}>Назначенную заявку мастер видит первой с пометкой «Назначено вам».</Text>
        </Card>
      ) : null}

      {r.status === 'in_work' && r.work_days != null ? (
        <Card style={styles.card}>
          <Text style={styles.h}>{r.work_days === 0 ? 'Взята в работу сегодня' : `В работе ${r.work_days} раб. дн.`}</Text>
          {r.taken_at ? <Text style={styles.hint}>с {formatDate(r.taken_at.slice(0, 10))}, без выходных и праздников</Text> : null}
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Field
          label={itsm ? 'Тема (для себя)' : 'Название заявки'}
          value={subject}
          onChangeText={setSubject}
          multiline
          hint={itsm ? 'Мастер видит текст заявки из ITSM. Без имён, фамилий и телефонов.' : 'Это название видит мастер. Без имён, фамилий и телефонов.'}
        />
      </Card>
      {message ? <Text style={styles.err}>{message}</Text> : null}
      <BigButton title="Сохранить" loading={busy === 'save'} disabled={!!busy} onPress={save} />

      <TourTarget id="rdetail.state">
      <Card style={styles.card}>
        <Text style={styles.h}>
          Статус: {card ? lifecycleLabel[card.status] : lifecycleLabel[r.status]}
          {card?.responsible_name ? ` · ${card.responsible_name}` : ''}
        </Text>
        {card?.pause_request ? (
          <View style={styles.pause}>
            <Text style={styles.pauseTitle}>Мастер просит приостановить</Text>
            <Text style={styles.body}>{card.pause_request}</Text>
            <Text style={styles.hint}>Пока вы не решили, заявка у мастера в работе и другую он взять не может.</Text>
            <BigButton
              title="Подтвердить — мастер свободен"
              loading={busy === 'pause-ok'}
              disabled={!!busy}
              onPress={() => run('pause-ok', async () => (await decidePause(r.id, true, null), reloadCard()))}
            />
            <Field label="Отклонить: почему нельзя" value={rejectText} onChangeText={setRejectText} multiline placeholder="Например: материалы привезут сегодня" />
            <BigButton
              title="Отклонить"
              variant="secondary"
              loading={busy === 'pause-no'}
              disabled={!!busy || rejectText.trim().length < 3}
              onPress={() => run('pause-no', async () => (await decidePause(r.id, false, rejectText.trim()), setRejectText(''), reloadCard()))}
            />
            <BigButton title="Передать подрядчику" variant="secondary" disabled={!!busy} onPress={() => assign(null, true)} />
          </View>
        ) : null}
        {card?.status === 'paused' ? (
          <View style={styles.pause}>
            <Text style={styles.pauseTitle}>{holdText(card.hold_reason, card.hold_number)}</Text>
            <BigButton
              title="Вернуть в работу"
              variant="secondary"
              loading={busy === 'resume'}
              disabled={!!busy}
              onPress={() => run('resume', async () => (await resumeRequest(r.id), reloadCard()))}
            />
            <Text style={styles.hint}>Если у мастера сейчас другая заявка в работе, вернуть не получится — сначала он её отправит.</Text>
          </View>
        ) : null}
        {card?.status === 'review' ? (
          <BigButton title="Проверить заявку" onPress={() => router.push({ pathname: '/review/[id]', params: { id: String(r.id) } })} />
        ) : null}
        {isOpen && card?.status !== 'accepted' ? (
          <>
            <Text style={styles.label}>Приоритет</Text>
            <View style={styles.chips}>
              {([1, 2, 3, 4] as Priority[]).map((p) => (
                <Chip
                  key={p}
                  label={priorityLabel[p]}
                  selected={(card?.priority ?? r.priority) === p}
                  onPress={() => !busy && run('priority', async () => (await setRequestPriority(r.id, p), reloadCard()))}
                />
              ))}
            </View>
          </>
        ) : null}
        {card && (card.status === 'in_work' || card.status === 'waiting' || card.status === 'paused') && isOpen ? (
          <>
            <Text style={styles.label}>{card.status === 'in_work' ? 'Переназначить или снять с мастера' : 'Отдать в работу мастеру'}</Text>
            <View style={styles.chips}>
              {card.status !== 'waiting' ? (
                <Chip
                  label="Снять с мастера"
                  onPress={async () => {
                    if (!(await confirm('Снять заявку с мастера?', `${card.responsible_name ?? 'Мастер'} больше не будет её вести, заявка снова «Ожидает».`, 'Снять'))) return;
                    run('resp', async () => (await setRequestResponsible(r.id, null), reloadCard()));
                  }}
                />
              ) : null}
              {(masters ?? []).map((m) => (
                <Chip
                  key={m.id}
                  label={m.display_name}
                  selected={card.responsible_id === m.id}
                  onPress={async () => {
                    if (card.responsible_id === m.id) return;
                    if (card.status !== 'waiting' && !(await confirm('Переназначить заявку?', `Заявку поведёт ${m.display_name} вместо ${card.responsible_name ?? 'текущего мастера'}.`, 'Переназначить'))) return;
                    run('resp', async () => (await setRequestResponsible(r.id, m.id), reloadCard()));
                  }}
                />
              ))}
            </View>
            <Text style={styles.hint}>«Снять» — заявка снова «Ожидает». Мастер, которому переназначили, увидит её в «Мои заявки».</Text>
            <Text style={styles.hint}>
              У мастера одна заявка в работе. Занятому можно отдать только «Срочно» — его текущая приостановится и вернётся сама, когда он отправит срочную.
              Обычную назначьте ему выше («Кому назначена») — возьмёт следующей.
            </Text>
            {message ? <Text style={styles.err}>{message}</Text> : null}
          </>
        ) : null}
      </Card>
      </TourTarget>

      {card?.works.length ? <WorksMoney requestId={card.id} works={card.works} /> : null}
      {card ? <RequestFeed requestId={card.id} events={card.events} onSent={reloadCard} /> : null}

      <BigButton
        title={isOpen ? (itsm ? 'Закрыть заявку (как в ITSM)' : 'Закрыть заявку') : 'Открыть снова'}
        variant={isOpen ? 'danger' : 'secondary'}
        loading={busy === 'open'}
        disabled={!!busy}
        onPress={toggleOpen}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  body: { fontSize: font.body },
  closed: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
  card: { gap: space.s12 },
  pause: { gap: space.s8, padding: space.s12, borderRadius: radius.card, borderWidth: stroke.outline, borderColor: colors.noteText, backgroundColor: colors.note },
  pauseTitle: { fontSize: font.body, fontWeight: '800', color: colors.noteText },
  h: { fontSize: font.body, fontWeight: '700' },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  hint: { fontSize: font.small, color: colors.muted },
  err: { color: colors.danger, fontSize: font.body },
});
