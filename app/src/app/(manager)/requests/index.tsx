import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { listRequests, type RequestRow } from '../../../lib/manager';
import { formatRegistered } from '../../../lib/requests';
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
      <Field label="Поиск" value={q} onChangeText={setQ} placeholder="номер, операция или текст" autoCorrect={false} />
      <BigButton title="Загрузить заявки из ITSM" onPress={() => router.push('/import')} />
      <Text style={styles.meta}>Сначала открытые. Нажмите на заявку, чтобы назначить её сотруднику или подрядчику либо закрыть.</Text>
      {!rows ? <StateView loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {rows && !rows.length ? <Text style={styles.meta}>Заявок не найдено</Text> : null}
      {rows?.map((r) => (
        <Card key={r.id} style={styles.card} onPress={() => router.push({ pathname: '/requests/[id]', params: { id: String(r.id), data: JSON.stringify(r) } })}>
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
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  number: { fontSize: font.body, fontWeight: '800' },
  subject: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.muted },
  closed: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
});
