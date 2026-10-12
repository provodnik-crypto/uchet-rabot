import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { listRequests, type RequestRow } from '../../../lib/manager';
import { formatMinutes, formatPlan } from '../../../lib/requestTime';
import { colors, font } from '../../../theme';

export default function RequestsScreen() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useFocusEffect(useCallback(() => setTick((t) => t + 1), []));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      listRequests(q)
        .then((r) => alive && (setRows(r), setError(null)))
        .catch((e) => alive && setError(humanError(e)))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, tick]);

  return (
    <Screen>
      <Field label="Поиск" value={q} onChangeText={setQ} placeholder="номер или тема" autoCorrect={false} />
      <Text style={styles.meta}>Заявки появляются сами, когда мастер вводит номер. Здесь можно дописать тему и плановое время. Красная рамка — потрачено больше плана. Имена и телефоны людей в тему не пишите.</Text>
      {!rows ? <StateView loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {rows && !rows.length ? <Text style={styles.meta}>Заявок не найдено</Text> : null}
      {rows?.map((r) => (
        <Card
          key={r.id}
          style={[styles.card, overPlan(r) && styles.over]}
          onPress={() => router.push({ pathname: '/requests/[id]', params: { id: String(r.id), data: JSON.stringify(r) } })}
        >
          <Text style={styles.number}>{r.number}</Text>
          {r.subject ? <Text style={styles.subject}>{r.subject}</Text> : null}
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
            {[`работ: ${r.entries}`, r.last_work_date ? `последняя ${formatDate(r.last_work_date)}` : null].filter(Boolean).join(' · ')}
          </Text>
        </Card>
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
});
