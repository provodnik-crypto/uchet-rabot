import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatRegistered, myRequests, openRequests, previewText, requestLabel, type OpenRequest } from '../lib/requests';
import { TourTarget } from '../lib/tour';
import { useFocusQuery } from '../lib/useQuery';
import { colors, font, lineHeight, opacity, radius, space, stroke } from '../theme';
import { DueLine } from './DueLine';
import { FilterPills } from './FilterPills';
import { LoadStatus } from './LoadStatus';
import { RequestBadges } from './RequestBadges';
import { useScreenRefresh } from './Screen';
import { StateView } from './StateView';
import { Text } from './Text';

export type ListFilter = 'free' | 'mine' | 'all';

const isFree = (r: OpenRequest) => r.status === 'waiting' && !r.to_contractor && (!r.assignee_id || r.mine);
const isMine = (r: OpenRequest) => r.mine || r.member;

type Props = {
  q: string;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
  /** id для обучения у первой заявки списка. */
  tourId: string;
};

/**
 * Открытые заявки магазина: фильтры «Свободные · N / Мне · N / Все», чёрная плашка про свою заявку
 * в работе, назначенные мне — сверху с жёлтой обводкой, взятые другими — бледнее с «В работе · Имя Ф.».
 */
export function RequestList({ q, filter, onFilter, tourId }: Props) {
  const query = useFocusQuery(() => openRequests(q, 'all'), {
    key: `open:all:${q}`,
    persist: !q,
    debounceMs: q ? 300 : 0,
  });
  const { data: rows, error, loading, reload } = query;
  useScreenRefresh(reload);
  // моя заявка «В работе»: пока она есть, другие не взять
  const mineQ = useFocusQuery(myRequests, { key: 'home:mine' });
  useScreenRefresh(mineQ.reload);
  const active = mineQ.data?.find((m) => m.status === 'in_work' && m.responsible) ?? null;

  const all = rows ? [...rows].sort((a, b) => Number(isMine(b)) - Number(isMine(a))) : null;
  const shown = all?.filter((r) => (filter === 'free' ? isFree(r) : filter === 'mine' ? isMine(r) : true)) ?? null;
  const open = (id: number) => router.push({ pathname: '/req/[id]', params: { id: String(id) } });

  return (
    <>
      <FilterPills<ListFilter>
        options={[
          { value: 'free', label: `Свободные · ${all ? all.filter(isFree).length : '…'}` },
          { value: 'mine', label: `Мне · ${all ? all.filter(isMine).length : '…'}` },
          { value: 'all', label: 'Все' },
        ]}
        value={filter}
        onChange={onFilter}
      />

      {active ? (
        <Pressable accessibilityRole="button" onPress={() => open(active.id)} style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
          <Text style={styles.bannerText}>
            У вас в работе <Text style={styles.bold}>{requestLabel(active.number)}</Text>. Новую можно взять после отправки на проверку.
          </Text>
        </Pressable>
      ) : null}
      <LoadStatus status={query} />
      {!shown ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {shown && !shown.length ? (
        <Text style={styles.meta}>{q ? 'Ничего не найдено' : filter === 'free' ? 'Свободных заявок нет' : filter === 'mine' ? 'Назначенных вам заявок нет' : 'Открытых заявок нет'}</Text>
      ) : null}
      {shown?.map((r, i) => {
        const busy = r.status === 'in_work' && !r.mine && !r.member;
        return (
          <TourTarget key={r.id} id={i === 0 ? tourId : `${tourId}.${r.id}`}>
            <Pressable
              accessibilityRole="button"
              onPress={() => open(r.id)}
              unstable_pressDelay={120}
              style={({ pressed }) => [styles.card, r.mine && styles.mine, busy && styles.busy, pressed && styles.pressed]}
            >
              <RequestBadges
                status={r.status}
                priority={r.priority}
                contractor={r.to_contractor}
                mine={r.mine}
                returned={r.returned && r.mine}
                responsibleName={busy ? r.responsible_name : null}
                unread={r.unread}
              />
              <Text style={styles.number}>{requestLabel(r.number)}</Text>
              {r.operation || r.description ? (
                <Text style={styles.text} numberOfLines={3}>
                  {r.operation ? `${r.operation}${r.description ? ': ' : ''}` : ''}
                  {previewText(r.description)}
                </Text>
              ) : null}
              <DueLine dueAt={r.due_at} status={r.status} />
              <Text style={styles.meta}>
                {[
                  formatRegistered(r.registered_at),
                  r.requester_name,
                  r.member ? 'вы напарник' : null,
                  !r.mine && r.assignee_name && r.status === 'waiting' ? `назначена: ${r.assignee_name}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Pressable>
          </TourTarget>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: opacity.pressed },
  banner: { backgroundColor: colors.black, borderRadius: radius.control, paddingVertical: space.s12, paddingHorizontal: space.s14 },
  bannerText: { fontSize: font.small, color: colors.onDark, lineHeight: lineHeight.small },
  bold: { fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: space.s16, gap: space.s6 },
  mine: { borderWidth: stroke.outline, borderColor: colors.brand, padding: space.s16 - stroke.outline },
  busy: { opacity: opacity.dim },
  number: { fontSize: font.lead, fontWeight: '700', marginTop: space.s2 },
  text: { fontSize: font.list, lineHeight: lineHeight.list },
  meta: { fontSize: font.caption, color: colors.secondary },
});
