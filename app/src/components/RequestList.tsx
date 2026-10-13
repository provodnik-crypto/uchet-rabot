import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { humanError } from '../lib/errors';
import { formatRegistered, openRequests, previewText, type OpenRequest, type RequestFilter } from '../lib/requests';
import { TourTarget } from '../lib/tour';
import { colors, font, radius } from '../theme';
import { formatPlan } from '../lib/requestTime';
import { Card } from './Card';
import { RequestBadges } from './RequestBadges';
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
          <Card
            style={[styles.card, r.mine && styles.mine, r.status === 'in_work' && !r.mine && !r.member && styles.locked]}
            onPress={() => {
              if (mode !== 'select' || !onChoose) return onOpen(r);
              const why = blockedReason(r);
              if (why) Alert.alert('Выбрать нельзя', why);
              else onChoose(r);
            }}
          >
            <View style={styles.row}>
              <View style={styles.flex}>
                <RequestBadges
                  status={r.status}
                  priority={r.priority}
                  mine={r.mine}
                  responsibleName={r.mine ? null : r.responsible_name}
                />
                {r.member ? <Text style={styles.memberText}>Вы напарник</Text> : null}
                {r.returned && r.mine ? <Text style={styles.returned}>Вернули — откройте заявку</Text> : null}
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
                !r.mine && r.assignee_name && r.status === 'waiting' ? `назначена: ${r.assignee_name}` : null,
                r.status === 'in_work' && r.plan_minutes ? `~${formatPlan(r.plan_minutes)}` : null,
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

/** Почему заявку нельзя выбрать для своей смены (null — можно). */
function blockedReason(r: OpenRequest): string | null {
  if (r.status === 'contractor') return 'Заявка у подрядчика.';
  if (r.status === 'review') return 'Заявка уже на проверке у руководителя.';
  if (r.status === 'in_work' && !r.mine) return `Заявку взял ${r.responsible_name ?? 'другой мастер'}.`;
  if (r.status === 'waiting' && r.assignee_id && !r.mine) return `Заявка назначена: ${r.assignee_name}.`;
  return null;
}

const styles = StyleSheet.create({
  card: { gap: 3 },
  mine: { borderWidth: 2, borderColor: colors.brand },
  locked: { opacity: 0.6 },
  memberText: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  returned: { fontSize: font.small, fontWeight: '800', color: colors.danger },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1, gap: 3 },
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
