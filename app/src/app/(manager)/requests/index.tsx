import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { listRequests, type RequestRow, type RequestStatusFilter } from '../../../lib/manager';
import { formatRegistered } from '../../../lib/requests';
import { formatMinutes, formatPlan } from '../../../lib/requestTime';
import { TourTarget } from '../../../lib/tour';
import { colors, font } from '../../../theme';

export default function RequestsScreen() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<RequestStatusFilter>('open');
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useFocusEffect(useCallback(() => setTick((t) => t + 1), []));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      listRequests(q, status)
        .then((r) => alive && (setRows(r), setError(null)))
        .catch((e) => alive && setError(humanError(e)))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, status, tick]);

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
      <BigButton title="Загрузить заявки из ITSM" onPress={() => router.push('/import')} />
      <BigButton title="Закрыть старые заявки" variant="secondary" onPress={() => router.push('/requests/close-old')} />
      <Text style={styles.meta}>Нажмите на заявку, чтобы назначить её мастеру или подрядчику, закрыть или открыть снова, задать плановое время. Красная рамка — потрачено больше плана.</Text>
      {!rows ? <StateView loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {rows && !rows.length ? <Text style={styles.meta}>{status === 'closed' ? 'Закрытых заявок нет' : 'Заявок не найдено'}</Text> : null}
      {rows?.map((r, i) => (
        <TourTarget key={r.id} id={i === 0 ? 'requests.first' : `requests.${r.id}`}>
        <Card
          key={r.id}
          style={[styles.card, overPlan(r) && styles.over]}
          onPress={() => router.push({ pathname: '/requests/[id]', params: { id: String(r.id), data: JSON.stringify(r) } })}
        >
          <Text style={styles.number}>
            {r.number}
            {r.source === 'itsm' && !r.is_open ? <Text style={styles.closed}>  закрыта</Text> : null}
          </Text>
          {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}
          {r.description || r.subject ? (
            <Text style={styles.subject} numberOfLines={2}>
              {r.description ?? r.subject}
            </Text>
          ) : null}
          {r.state ? (
            <Text style={[styles.state, r.state === 'open' && styles.open]}>
              {r.state === 'done' ? 'Выполнена' : 'Не закончена'}
              {r.carries ? ` · переносов: ${r.carries}` : ''}
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
  closed: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
});
