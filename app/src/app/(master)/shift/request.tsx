import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { useDraft } from '../../../lib/draft';
import { humanError } from '../../../lib/errors';
import { formatRegistered, openRequests, type OpenRequest, type RequestFilter } from '../../../lib/requests';
import { formatRequestDigits, requestError, requestNumber, type RequestPrefix } from '../../../lib/shift';
import { colors, font, radius } from '../../../theme';

const FILTERS: { key: RequestFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'mine', label: 'Назначены мне' },
  { key: 'contractor', label: 'Подрядчик' },
];

export default function RequestScreen() {
  const { draft, setRequest } = useDraft();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [rows, setRows] = useState<OpenRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [manual, setManual] = useState(false);

  useFocusEffect(useCallback(() => setTick((t) => t + 1), []));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(
      () => {
        openRequests(q, filter)
          .then((r) => alive && (setRows(r), setError(null)))
          .catch((e) => alive && setError(humanError(e)))
          .finally(() => alive && setLoading(false));
      },
      q ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, filter, tick]);

  // Номера, уже добавленные в эту смену, — первыми, одним касанием.
  const inShift = Array.from(new Set((draft?.entries ?? []).map((e) => e.requestNumber).filter((n): n is string => !!n)));

  const choose = (number: string | null) => {
    setRequest(number);
    router.replace('/shift/work');
  };

  return (
    <Screen>
      {inShift.length ? (
        <>
          <Text style={styles.section}>Уже в этой смене</Text>
          <View style={styles.wrap}>
            {inShift.map((n) => (
              <Chip key={n} label={n} onPress={() => choose(n)} />
            ))}
          </View>
        </>
      ) : null}

      <Field label="Поиск заявки" value={q} onChangeText={setQ} placeholder="номер или слово из текста" autoCorrect={false} />
      <View style={styles.wrap}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>

      {!rows ? <StateView loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {rows && !rows.length ? (
        <Text style={styles.meta}>{q || filter !== 'all' ? 'Ничего не найдено' : 'Открытых заявок нет'}</Text>
      ) : null}
      {rows?.map((r) => (
        <Card key={r.id} style={[styles.card, r.mine && styles.mine]} onPress={() => choose(r.number)}>
          {r.mine ? <Text style={styles.badge}>Назначено вам</Text> : null}
          <Text style={styles.number}>{r.number}</Text>
          {r.operation ? <Text style={styles.operation}>{r.operation}</Text> : null}
          {r.description ? (
            <Text style={styles.desc} numberOfLines={2}>
              {r.description}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {[
              formatRegistered(r.registered_at),
              r.requester_name,
              !r.mine && r.assignee_name ? `назначена: ${r.assignee_name}` : null,
              r.to_contractor ? 'подрядчик' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Card>
      ))}

      {manual ? (
        <ManualNumber onDone={choose} />
      ) : (
        <BigButton title="Нет в списке — ввести номер" variant="secondary" onPress={() => setManual(true)} />
      )}
      <BigButton title="Без заявки (плановые работы)" variant="secondary" onPress={() => choose(null)} />
    </Screen>
  );
}

/** Запасной вариант: номер заявки вручную — RFS/INC и 10 цифр. */
function ManualNumber({ onDone }: { onDone: (number: string) => void }) {
  const [prefix, setPrefix] = useState<RequestPrefix>('RFS');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Card style={styles.manual}>
      <Text style={styles.h}>Номер заявки</Text>
      <View style={styles.wrap}>
        <Chip label="RFS" selected={prefix === 'RFS'} onPress={() => setPrefix('RFS')} />
        <Chip label="INC" selected={prefix === 'INC'} onPress={() => setPrefix('INC')} />
      </View>
      <Field
        label={`Цифры номера: ${prefix}${formatRequestDigits(digits) || '______ ____'}`}
        value={formatRequestDigits(digits)}
        onChangeText={(t) => {
          setDigits(t.replace(/\D/g, '').slice(0, 10));
          setError(null);
        }}
        keyboardType="number-pad"
        placeholder="260423_2283"
        maxLength={11}
        error={error}
        hint="Наберите 10 цифр — подчёркивание поставится само"
        autoFocus
      />
      <BigButton
        title="Дальше"
        onPress={() => {
          const e = requestError(digits);
          setError(e);
          if (!e) onDone(requestNumber(prefix, digits));
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  mine: { borderWidth: 3, borderColor: colors.brand },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brand,
    borderRadius: radius.chip,
    paddingHorizontal: 10,
    paddingVertical: 2,
    fontSize: font.small,
    fontWeight: '800',
    overflow: 'hidden',
  },
  number: { fontSize: font.body, fontWeight: '800' },
  operation: { fontSize: font.small, fontWeight: '700' },
  desc: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.muted },
  manual: { gap: 12 },
  h: { fontSize: font.body, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
});
