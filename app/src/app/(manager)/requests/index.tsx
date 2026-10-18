import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { listRequests, type RequestRow, type RequestStatusFilter } from '../../../lib/manager';
import { formatRegistered, lifecycleLabel, priorityLabel, type LifecycleStatus, type Priority, requestLabel } from '../../../lib/requests';
import { listMasters } from '../../../lib/shift';
import { useFocusQuery } from '../../../lib/useQuery';
import { FilterSelect } from '../../../components/FilterSelect';
import { RequestBadges } from '../../../components/RequestBadges';
import { formatMinutes, formatPlan } from '../../../lib/requestTime';
import { TourTarget } from '../../../lib/tour';
import { colors, font } from '../../../theme';
import { DueLine } from '../../../components/DueLine';

export default function RequestsScreen() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<RequestStatusFilter>('open');
  const params = useLocalSearchParams<{ lifecycle?: LifecycleStatus }>();
  const [lifecycle, setLifecycle] = useState<LifecycleStatus | null>(params.lifecycle ?? null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [employee, setEmployee] = useState<number | null>(null);
  const { data: masters } = useFocusQuery(listMasters);
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useFocusEffect(useCallback(() => setTick((t) => t + 1), []));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      listRequests(q, status, { lifecycle, priority, employee })
        .then((r) => alive && (setRows(r), setError(null)))
        .catch((e) => alive && setError(humanError(e)))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, status, lifecycle, priority, employee, tick]);

  return (
    <Screen>
      <Field label="Поиск" value={q} onChangeText={setQ} placeholder="номер, операция или текст" autoCorrect={false} />
      <Segmented<RequestStatusFilter>
        options={[
          { value: 'open', label: 'Открытые' },
          { value: 'closed', label: 'Закрытые' },
          { value: 'all', label: 'Все' },
        ]}
        value={status}
        onChange={setStatus}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled">
        <FilterSelect
          label="Статус"
          allLabel="Все статусы"
          value={lifecycle}
          onChange={setLifecycle}
          options={(Object.keys(lifecycleLabel) as LifecycleStatus[]).map((v) => ({ value: v, label: lifecycleLabel[v] }))}
        />
        <FilterSelect
          label="Приоритет"
          allLabel="Любой приоритет"
          value={priority}
          onChange={setPriority}
          options={([1, 2, 3, 4] as Priority[]).map((v) => ({ value: v, label: priorityLabel[v] }))}
        />
        <FilterSelect
          label="Мастер"
          allLabel="Все мастера"
          value={employee}
          onChange={setEmployee}
          options={(masters ?? []).map((m) => ({ value: m.id, label: m.display_name }))}
        />
      </ScrollView>
      <BigButton title="+ Новая заявка" onPress={() => router.push('/requests/new')} />
      <BigButton title="Загрузить заявки из ITSM" variant="secondary" onPress={() => router.push('/import')} />
      <BigButton title="Закрыть старые заявки" variant="secondary" onPress={() => router.push('/requests/close-old')} />
      <Text style={styles.meta}>Нажмите на заявку, чтобы назначить её мастеру или подрядчику, закрыть или открыть снова, задать плановое время. Красная рамка — потрачено больше плана.</Text>
      {!rows ? <StateView loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {rows && !rows.length ? <Text style={styles.meta}>{status === 'closed' ? 'Закрытых заявок нет' : 'Заявок не найдено'}</Text> : null}
      {rows?.map((r, i) => (
        <TourTarget key={r.id} id={i === 0 ? 'requests.first' : `requests.${r.id}`}>
        <Card
          key={r.id}
          style={[styles.card, overPlan(r) && styles.over, r.stale_days > 3 && styles.stale]}
          onPress={() => router.push({ pathname: '/requests/[id]', params: { id: String(r.id), data: JSON.stringify(r) } })}
        >
          <RequestBadges status={r.status} priority={r.priority} responsibleName={r.responsible_name} unread={r.unread} />
          {r.status === 'in_work' && r.taken_at ? (
            <Text style={[styles.meta, r.stale_days > 3 && styles.overText]}>
              в работе {daysSince(r.taken_at)} дн.{r.stale_days > 3 ? ` · без действий ${r.stale_days} раб. дн.` : ''}
              {r.returned_comment ? ' · возвращена' : ''}
            </Text>
          ) : null}
          <Text style={styles.number}>
            {requestLabel(r.number)}
            {r.source === 'itsm' && !r.is_open ? <Text style={styles.closed}>  закрыта</Text> : null}
          </Text>
          {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}
          <DueLine dueAt={r.due_at} status={r.status} isOpen={r.is_open} />
          {r.description || r.subject ? (
            <Text style={styles.subject} numberOfLines={2}>
              {r.description ?? r.subject}
            </Text>
          ) : null}
          {r.spent_minutes != null || r.plan_minutes != null ? (
            <Text style={[styles.meta, overPlan(r) && styles.overText]}>
              {r.plan_minutes != null ? `План ${formatPlan(r.plan_minutes)} · ` : ''}факт {formatMinutes(r.spent_minutes ?? 0)}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {[
              r.registered_at ? formatRegistered(r.registered_at) : r.source === 'manual' ? 'введена вручную' : null,
              r.to_contractor ? 'подрядчик' : r.assignee_name ? `назначена: ${r.assignee_name}` : null,
              `работ: ${r.entries}`,
              r.last_work_date ? `последняя ${formatDate(r.last_work_date)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Card>
        </TourTarget>
      ))}
    </Screen>
  );
}

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));

const overPlan = (r: RequestRow) => r.plan_minutes != null && (r.spent_minutes ?? 0) > r.plan_minutes;

const styles = StyleSheet.create({
  over: { borderWidth: 3, borderColor: colors.danger },
  overText: { color: colors.danger, fontWeight: '800' },
  state: { fontSize: font.small, fontWeight: '800', color: colors.success },
  open: { color: '#8A6500' },
  card: { gap: 4 },
  number: { fontSize: font.body, fontWeight: '800' },
  subject: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.muted },
  filters: { gap: 8, paddingVertical: 2 },
  stale: { borderWidth: 2, borderColor: '#E65100' },
  closed: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
});
