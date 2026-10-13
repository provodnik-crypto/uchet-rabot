import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { SearchBox } from '../../../components/SearchBox';
import { Segmented } from '../../../components/Segmented';
import { StateView } from '../../../components/StateView';
import { useDraft } from '../../../lib/draft';
import { humanError } from '../../../lib/errors';
import { formatRegistered, openRequests, type OpenRequest, type RequestFilter } from '../../../lib/requests';
import { formatRequestDigits, requestError, requestNumber, type RequestPrefix } from '../../../lib/shift';
import { TourTarget } from '../../../lib/tour';
import { colors, font, radius } from '../../../theme';

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
  const inShift = Array.from(
    new Set([...(draft?.requests ?? []).map((r) => r.number), ...(draft?.entries ?? []).map((e) => e.requestNumber)].filter((n): n is string => !!n)),
  );

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

      <SearchBox label="Поиск заявки" value={q} onChangeText={setQ} placeholder="Номер или слово из текста" autoCorrect={false} />
      <Segmented<RequestFilter>
        options={[
          { value: 'all', label: 'Все' },
          { value: 'mine', label: 'Назначены мне' },
          { value: 'contractor', label: 'Подрядчик' },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {!rows ? <StateView loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {rows && !rows.length ? (
        <Text style={styles.meta}>{q || filter !== 'all' ? 'Ничего не найдено' : 'Открытых заявок нет'}</Text>
      ) : null}
      {rows?.map((r, i) => (
        <TourTarget key={r.id} id={i === 0 ? 'request.list' : `request.${r.id}`}>
          <Card style={[styles.card, r.mine && styles.mine]} onPress={() => choose(r.number)}>
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
        </TourTarget>
      ))}

      <TourTarget id="request.manualOpen">
        {manual ? (
          <ManualNumber onDone={choose} />
        ) : (
          <BigButton title="Нет в списке — ввести номер" variant="secondary" onPress={() => setManual(true)} />
        )}
      </TourTarget>
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
      <Segmented<RequestPrefix>
        options={[
          { value: 'RFS', label: 'RFS' },
          { value: 'INC', label: 'INC' },
        ]}
        value={prefix}
        onChange={setPrefix}
      />
      <TourTarget id="request.digits">
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
      </TourTarget>
      <TourTarget id="request.next">
        <BigButton
          title="Дальше"
          onPress={() => {
            const e = requestError(digits);
            setError(e);
            if (!e) onDone(requestNumber(prefix, digits));
          }}
        />
      </TourTarget>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 3 },
  mine: { borderWidth: 2, borderColor: colors.brand },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brand,
    borderRadius: radius.chip,
    paddingHorizontal: 8,
    paddingVertical: 1,
    fontSize: font.small,
    fontWeight: '800',
    overflow: 'hidden',
  },
  number: { fontSize: font.body, fontWeight: '800' },
  operation: { fontSize: font.small, fontWeight: '700' },
  desc: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.secondary },
  manual: { gap: 10 },
  h: { fontSize: font.body, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  section: { fontSize: font.small, fontWeight: '700', color: colors.secondary, marginBottom: -4 },
});
