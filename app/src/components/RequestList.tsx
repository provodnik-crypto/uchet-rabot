import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatRegistered, myRequests, openRequests, previewText, type OpenRequest, type RequestFilter, requestLabel } from '../lib/requests';
import { router } from 'expo-router';
import { BigButton } from './BigButton';
import { TourTarget } from '../lib/tour';
import { colors, font } from '../theme';
import { Card } from './Card';
import { RequestBadges } from './RequestBadges';
import { SearchBox } from './SearchBox';
import { Segmented } from './Segmented';
import { StateView } from './StateView';
import { LoadStatus } from './LoadStatus';
import { useScreenRefresh } from './Screen';
import { useFocusQuery } from '../lib/useQuery';
import { DueLine } from './DueLine';

type Props = {
  /** Нажатие на заявку открывает её карточку. */
  onOpen: (r: OpenRequest) => void;
  /** id для обучения у первой заявки списка. */
  tourId: string;
};

/** Открытые заявки магазина: поиск, фильтры «Все / Назначены мне / Подрядчик», назначенные мне — сверху. */
export function RequestList({ onOpen, tourId }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RequestFilter>('all');
  const query = useFocusQuery(() => openRequests(q, filter), {
    key: `open:${filter}:${q}`,
    persist: !q,
    debounceMs: q ? 300 : 0,
  });
  const { data: rows, error, loading, reload } = query;
  useScreenRefresh(reload);
  // моя заявка «В работе»: пока она есть, другие не взять
  const mineQ = useFocusQuery(myRequests, { key: 'home:mine' });
  useScreenRefresh(mineQ.reload);
  const active = mineQ.data?.find((m) => m.status === 'in_work' && m.responsible) ?? null;

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

      {active ? (
        <Card style={styles.active}>
          <Text style={styles.activeTitle}>Сначала завершите {requestLabel(active.number)}</Text>
          <Text style={styles.desc}>Внесите работы и отправьте её на проверку («Проверить и отправить») — после этого можно взять следующую.</Text>
          <BigButton title={`Открыть ${requestLabel(active.number)}`} variant="secondary" onPress={() => router.push({ pathname: '/req/[id]', params: { id: String(active.id) } })} />
        </Card>
      ) : null}
      <LoadStatus status={query} />
      {!rows ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {rows && !rows.length ? (
        <Text style={styles.meta}>{q || filter !== 'all' ? 'Ничего не найдено' : 'Открытых заявок нет'}</Text>
      ) : null}
      {rows?.map((r, i) => (
        <TourTarget key={r.id} id={i === 0 ? tourId : `${tourId}.${r.id}`}>
          <Card
            style={[styles.card, r.mine && styles.mine, r.status === 'in_work' && !r.mine && !r.member && styles.locked]}
            onPress={() => onOpen(r)}
          >
            <View style={styles.row}>
              <View style={styles.flex}>
                <RequestBadges
                  status={r.status}
                  priority={r.priority}
                  mine={r.mine}
                  responsibleName={r.mine ? null : r.responsible_name}
                  unread={r.unread}
                />
                {r.member ? <Text style={styles.memberText}>Вы напарник</Text> : null}
                {r.returned && r.mine ? <Text style={styles.returned}>Вернули — откройте заявку</Text> : null}
                <Text style={styles.number}>{requestLabel(r.number)}</Text>
                {r.operation ? <Text style={styles.operation}>{r.operation}</Text> : null}
              </View>
            </View>
            {r.description ? (
              <Text style={styles.desc} numberOfLines={3}>
                {previewText(r.description)}
              </Text>
            ) : null}
            <DueLine dueAt={r.due_at} status={r.status} />
            <Text style={styles.meta}>
              {[
                formatRegistered(r.registered_at),
                r.requester_name,
                !r.mine && r.assignee_name && r.status === 'waiting' ? `назначена: ${r.assignee_name}` : null,
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
  active: { gap: 8, borderWidth: 2, borderColor: '#E65100' },
  activeTitle: { fontSize: font.body, fontWeight: '800', color: '#E65100' },
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
});
