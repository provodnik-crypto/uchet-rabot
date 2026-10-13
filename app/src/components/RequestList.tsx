import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { humanError } from '../lib/errors';
import { formatRegistered, openRequests, previewText, type OpenRequest, type RequestFilter } from '../lib/requests';
import { TourTarget } from '../lib/tour';
import { colors, font, radius } from '../theme';
import { Card } from './Card';
import { SearchBox } from './SearchBox';
import { Segmented } from './Segmented';
import { StateView } from './StateView';

type Props = {
  /** view — нажатие открывает карточку; select — выбирает заявку для смены, «i» открывает карточку. */
  mode: 'view' | 'select';
  onOpen: (r: OpenRequest) => void;
  onChoose?: (r: OpenRequest) => void;
  /** id для обучения у первой заявки списка. */
  tourId: string;
};

/** Открытые заявки магазина: поиск, фильтры «Все / Назначены мне / Подрядчик», назначенные мне — сверху. */
export function RequestList({ mode, onOpen, onChoose, tourId }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [rows, setRows] = useState<OpenRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

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

  return (
    <>
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
        <TourTarget key={r.id} id={i === 0 ? tourId : `${tourId}.${r.id}`}>
          <Card style={[styles.card, r.mine && styles.mine]} onPress={() => (mode === 'select' && onChoose ? onChoose(r) : onOpen(r))}>
            <View style={styles.row}>
              <View style={styles.flex}>
                {r.mine ? <Text style={styles.badge}>Назначено вам</Text> : null}
                <Text style={styles.number}>{r.number}</Text>
                {r.operation ? <Text style={styles.operation}>{r.operation}</Text> : null}
              </View>
              {mode === 'select' ? (
                <TourTarget id={i === 0 ? `${tourId}.info` : `${tourId}.info.${r.id}`}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Подробнее о заявке ${r.number}`}
                    hitSlop={10}
                    onPress={() => onOpen(r)}
                    style={({ pressed }) => [styles.info, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.infoText}>i</Text>
                  </Pressable>
                </TourTarget>
              ) : null}
            </View>
            {r.description ? (
              <Text style={styles.desc} numberOfLines={3}>
                {previewText(r.description)}
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
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 3 },
  mine: { borderWidth: 2, borderColor: colors.brand },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1, gap: 3 },
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
  info: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { fontSize: font.body, fontWeight: '800', fontStyle: 'italic' },
});
