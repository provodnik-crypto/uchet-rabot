import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { RequestFeed } from '../../../components/RequestFeed';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { listRequests, updateRequest, type RequestRow } from '../../../lib/manager';
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
  type Priority,
} from '../../../lib/requests';
import { formatMinutes, formatPlan, PLAN_TIMES } from '../../../lib/requestTime';
import { listMasters } from '../../../lib/shift';
import { useFocusQuery } from '../../../lib/useQuery';
import { TourTarget } from '../../../lib/tour';
import { colors, font, radius, touch } from '../../../theme';

const PLAN_STEP = 30;

/** Открывается из списка (данные строки в параметрах) или по номеру — из уведомлений на главной. */
export default function RequestScreen() {
  const { data, id, number } = useLocalSearchParams<{ id: string; data?: string; number?: string }>();
  const { data: rows, error, loading, reload } = useFocusQuery(() =>
    data ? Promise.resolve([JSON.parse(data) as RequestRow]) : listRequests(number ?? '', 'all'),
  );
  const row = rows?.find((x) => x.id === Number(id));
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
  const [plan, setPlan] = useState<number | null>(r.plan_minutes);
  const { data: card, reload: reloadCard } = useFocusQuery(() => requestCard({ id: r.id }));
  useFocusEffect(useCallback(() => void markRequestRead(r.id), [r.id]));
  const { data: masters } = useFocusQuery(listMasters);
  const [assignee, setAssignee] = useState<number | null>(r.assignee_id);
  const [contractor, setContractor] = useState(r.to_contractor);
  const [isOpen, setIsOpen] = useState(r.is_open);
  const itsm = r.source === 'itsm';
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const spent = r.spent_minutes ?? 0;
  const over = plan != null && spent > plan;

  async function save() {
    setBusy('save');
    setMessage(null);
    try {
      await updateRequest(r.id, { subject: subject.trim() || null, plan_minutes: plan });
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

  const assign = (employeeId: number | null, toContractor: boolean) =>
    run('assign', async () => {
      await assignRequest(r.id, employeeId, toContractor);
      setAssignee(employeeId);
      setContractor(toContractor);
      reloadCard();
    });

  async function toggleOpen() {
    if (isOpen && !(await confirm('Закрыть заявку?', 'Мастера перестанут видеть её в списке заявок.', 'Закрыть'))) return;
    run('open', async () => {
      await setRequestOpen(r.id, !isOpen);
      setIsOpen(!isOpen);
    });
  }

  const step = (d: number) => setPlan(Math.max(PLAN_STEP, (plan ?? 0) + d));

  return (
    <Screen>
      <Text style={styles.number}>{r.number}</Text>
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
          {!isOpen ? <Text style={styles.closed}>Закрыта</Text> : null}
        </Card>
      ) : null}

      {itsm && isOpen ? (
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

      <TourTarget id="rdetail.plan">
      <Card style={[styles.card, over && styles.overCard]}>
        <Text style={styles.h}>Время</Text>
        <Text style={[styles.fact, over && styles.overText]}>
          Факт: {formatMinutes(spent)}
          {plan != null ? ` из плана ${formatPlan(plan)}` : ''}
          {over ? ' — больше плана' : ''}
        </Text>
        <Text style={styles.label}>План</Text>
        <View style={styles.chips}>
          <Chip label="Без плана" selected={plan == null} onPress={() => setPlan(null)} />
          {PLAN_TIMES.map((p) => (
            <Chip key={p.label} label={p.label} selected={plan === p.minutes} onPress={() => setPlan(p.minutes)} />
          ))}
        </View>
        <View style={styles.stepper}>
          <Pressable accessibilityRole="button" accessibilityLabel="Меньше на 30 минут" style={styles.stepBtn} onPress={() => step(-PLAN_STEP)}>
            <Text style={styles.stepText}>−30</Text>
          </Pressable>
          <Text style={styles.value}>{plan == null ? 'без плана' : formatPlan(plan)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Больше на 30 минут" style={styles.stepBtn} onPress={() => step(PLAN_STEP)}>
            <Text style={styles.stepText}>+30</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>1 день = смена 8 ч.</Text>
      </Card>
      </TourTarget>

      <Card style={styles.card}>
        <Field label="Тема" value={subject} onChangeText={setSubject} multiline hint="Что нужно сделать. Без имён, фамилий и телефонов." />
      </Card>
      {message ? <Text style={styles.err}>{message}</Text> : null}
      <BigButton title="Сохранить" loading={busy === 'save'} disabled={!!busy} onPress={save} />

      <TourTarget id="rdetail.state">
      <Card style={styles.card}>
        <Text style={styles.h}>
          Статус: {card ? lifecycleLabel[card.status] : lifecycleLabel[r.status]}
          {card?.responsible_name ? ` · ${card.responsible_name}` : ''}
        </Text>
        {card?.status === 'review' ? (
          <BigButton title="Проверить заявку" onPress={() => router.push({ pathname: '/review/[id]', params: { id: String(r.id) } })} />
        ) : null}
        <Text style={styles.label}>Приоритет</Text>
        <View style={styles.chips}>
          {([1, 2, 3, 4] as Priority[]).map((p) => (
            <Chip
              key={p}
              label={priorityLabel[p]}
              selected={(card?.priority ?? r.priority) === p}
              onPress={() => run('priority', async () => (await setRequestPriority(r.id, p), reloadCard()))}
            />
          ))}
        </View>
        {card && (card.status === 'in_work' || card.status === 'waiting') && isOpen ? (
          <>
            <Text style={styles.label}>{card.status === 'in_work' ? 'Переназначить или снять с мастера' : 'Отдать в работу мастеру'}</Text>
            <View style={styles.chips}>
              {card.status === 'in_work' ? (
                <Chip label="Снять с мастера" onPress={() => run('resp', async () => (await setRequestResponsible(r.id, null), reloadCard()))} />
              ) : null}
              {(masters ?? []).map((m) => (
                <Chip
                  key={m.id}
                  label={m.display_name}
                  selected={card.responsible_id === m.id}
                  onPress={() => run('resp', async () => (await setRequestResponsible(r.id, m.id), reloadCard()))}
                />
              ))}
            </View>
            <Text style={styles.hint}>«Снять» — заявка снова «Ожидает». Мастер, которому переназначили, увидит её в «Мои заявки».</Text>
          </>
        ) : null}
      </Card>
      </TourTarget>

      {card ? <RequestFeed requestId={card.id} events={card.events} onSent={reloadCard} /> : null}

      {itsm ? (
        <BigButton
          title={isOpen ? 'Закрыть заявку (как в ITSM)' : 'Открыть снова'}
          variant={isOpen ? 'danger' : 'secondary'}
          loading={busy === 'open'}
          disabled={!!busy}
          onPress={toggleOpen}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  body: { fontSize: font.body },
  closed: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
  card: { gap: 12 },
  overCard: { borderWidth: 3, borderColor: colors.danger },
  h: { fontSize: font.body, fontWeight: '700' },
  fact: { fontSize: font.body, fontWeight: '800' },
  overText: { color: colors.danger },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  value: { flex: 1, textAlign: 'center', fontSize: font.body, fontWeight: '800' },
  hint: { fontSize: font.small, color: colors.muted },
  err: { color: colors.danger, fontSize: font.body },
});
