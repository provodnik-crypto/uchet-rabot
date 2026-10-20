import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { listRequests, type RequestRow, type RequestStatusFilter } from '../../../lib/manager';
import { formatRegistered, holdText, lifecycleLabel, mastersNow, priorityLabel, type LifecycleStatus, type Priority, requestLabel } from '../../../lib/requests';
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
  const params = useLocalSearchParams<{ lifecycle?: LifecycleStatus | 'pause_request' }>();
  const [lifecycle, setLifecycle] = useState<LifecycleStatus | 'pause_request' | null>(params.lifecycle ?? null);
  // кто над какой заявкой работает сейчас
  const nowQ = useFocusQuery(mastersNow, { key: 'masters-now' });
  const [priority, setPriority] = useState<Priority | null>(null);
  const [employee, setEmployee] = useState<number | null>(null);
  const { data: masters } = useFocusQuery(listMasters);
  const query = useFocusQuery(() => listRequests(q, status, { lifecycle, priority, employee }), {
    key: `requests:${status}:${lifecycle ?? ''}:${priority ?? ''}:${employee ?? ''}:${q}`,
    persist: !q,
    debounceMs: 300,
  });
  const { data: rows, error, loading, reload } = query;

  return (
    <Screen status={[query, nowQ]}>
      {nowQ.data?.length ? (
        <TourTarget id="requests.now">
          <Card style={styles.now}>
            <Text style={styles.nowTitle}>Сейчас в работе</Text>
            {nowQ.data.map((m) => {
              const over = m.plan_minutes != null && (m.spent_minutes ?? 0) > m.plan_minutes;
              return (
                <Pressable
                  key={m.employee_id}
                  accessibilityRole="button"
                  disabled={!m.request_id}
                  onPress={() => m.request_id && router.push({ pathname: '/requests/[id]', params: { id: String(m.request_id), number: m.number ?? '' } })}
                  style={({ pressed }) => [styles.nowRow, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.nowName}>{m.display_name}</Text>
                  {m.request_id ? (
                    <>
                      <Text style={styles.nowReq}>
                        {m.priority === 1 ? '● ' : ''}
                        {requestLabel(m.number)}
                        {m.operation ? ` · ${m.operation}` : ''}
                      </Text>
                      <Text style={[styles.meta, over && styles.overText]}>
                        {m.taken_at ? `с ${formatDate(m.taken_at.slice(0, 10))} · ` : ''}
                        отмечено {formatMinutes(m.spent_minutes ?? 0)}
                        {m.plan_minutes != null ? ` из ~${formatPlan(m.plan_minutes)}` : ''}
                        {over ? ' — дольше примерного' : ''}
                      </Text>
                      {m.pause_request ? <Text style={styles.nowWarn}>Просит приостановить: {m.pause_request}</Text> : null}
                      {m.returned ? <Text style={styles.meta}>Вернули на доработку</Text> : null}
                    </>
                  ) : (
                    <Text style={styles.meta}>Свободен</Text>
                  )}
                  {m.paused ? <Text style={styles.meta}>Приостановлено: {m.paused}</Text> : null}
                </Pressable>
              );
            })}
          </Card>
        </TourTarget>
      ) : null}
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
          options={[
            ...(Object.keys(lifecycleLabel) as LifecycleStatus[]).map((v) => ({ value: v as LifecycleStatus | 'pause_request', label: lifecycleLabel[v] })),
            { value: 'pause_request' as const, label: 'Запросы на приостановку' },
          ]}
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
      {!rows ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
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
          {r.pause_request ? <Text style={styles.nowWarn}>Мастер просит приостановить: {r.pause_request}</Text> : null}
          {r.status === 'paused' ? <Text style={styles.nowWarn}>{holdText(r.hold_reason, r.hold_number)}</Text> : null}
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
  now: { gap: 6 },
  nowTitle: { fontSize: font.body, fontWeight: '800' },
  nowRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.bg, gap: 2 },
  nowName: { fontSize: font.body, fontWeight: '700' },
  nowReq: { fontSize: font.small, fontWeight: '700' },
  nowWarn: { fontSize: font.small, fontWeight: '700', color: '#E65100' },
});
