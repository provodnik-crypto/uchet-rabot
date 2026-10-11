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
      <Text style={styles.meta}>Заявки появляются сами, когда мастер вводит номер. Здесь можно дописать тему. Имена и телефоны людей в тему не пишите.</Text>
      {!rows ? <StateView loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {rows && !rows.length ? <Text style={styles.meta}>Заявок не найдено</Text> : null}
      {rows?.map((r) => (
        <Card key={r.id} style={styles.card} onPress={() => router.push({ pathname: '/requests/[id]', params: { id: String(r.id), data: JSON.stringify(r) } })}>
          <Text style={styles.number}>{r.number}</Text>
          {r.subject ? <Text style={styles.subject}>{r.subject}</Text> : null}
          <Text style={styles.meta}>
            {[`работ: ${r.entries}`, r.last_work_date ? `последняя ${formatDate(r.last_work_date)}` : null]
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
});
