import { router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import { Card } from '../../components/Card';
import { Icon, type IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { appVersionLabel } from '../../lib/appUpdate';
import { useAuth } from '../../lib/auth';
import { awaitingTotals, managerDashboard, managerRatingSummary, monthName, presetPeriod, requestCounts } from '../../lib/manager';
import { myNotifications, reviewCount, requestLabel } from '../../lib/requests';
import { Notices, type Notice } from '../../components/Notices';
import { formatKop } from '../../lib/money';
import { storeToday } from '../../lib/today';
import { TourTarget, useTour } from '../../lib/tour';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font, iconSize, opacity, radius, size, space, stroke, touch } from '../../theme';

type Href = Parameters<typeof router.push>[0];

/** «1 оценка / 2 оценки / 5 оценок». */
function pluralRatings(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'оценка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'оценки';
  return 'оценок';
}

export default function ManagerHome() {
  const { me, signOut } = useAuth();
  const dashQ = useFocusQuery(managerDashboard, { key: 'mhome:dashboard' });
  const reviewQ = useFocusQuery(reviewCount, { key: 'mhome:review' });
  const notesQ = useFocusQuery(myNotifications, { key: 'mhome:notes' });
  const { data } = dashQ;
  const { data: review } = reviewQ;
  const { data: notes } = notesQ;
  // Частые «Новое по заявке …» сворачиваются в одну строку; редкое важное — всегда на виду.
  const [showAllNews, setShowAllNews] = useState(false);
  const allUnread = notes?.unread ?? [];
  const news = allUnread.filter((n) => !n.refused);
  const refusedNews = allUnread.filter((n) => n.refused);
  const notices: Notice[] = [
    ...(showAllNews
      ? [
          { key: 'news-fold', tone: 'blue' as const, title: `Новое по заявкам: ${news.length}`, text: 'Нажмите, чтобы свернуть', onPress: () => setShowAllNews(false) },
          ...news.map((n) => ({
            key: `u${n.id}`,
            tone: 'blue' as const,
            title: `Новое по заявке ${requestLabel(n.number)}`,
            text: `Сообщений и событий: ${n.count}`,
            onPress: () => router.push({ pathname: '/requests/[id]', params: { id: String(n.id), number: n.number } }),
          })),
        ]
      : news.length
        ? [{ key: 'news', tone: 'blue' as const, title: `Новое по заявкам: ${news.length}`, text: 'Нажмите, чтобы показать', onPress: () => setShowAllNews(true) }]
        : []),
    ...refusedNews.map((n) => ({
      key: `u${n.id}`,
      tone: 'red' as const,
      title: `Отказ от заявки ${requestLabel(n.number)}`,
      text: `Сообщений и событий: ${n.count}`,
      onPress: () => router.push({ pathname: '/requests/[id]', params: { id: String(n.id), number: n.number } }),
    })),
    ...(typeof notes?.reports === 'number' && notes.reports
      ? [{ key: 'reports', tone: 'blue' as const, title: `Сообщения от мастеров: ${notes.reports}`, onPress: () => router.push('/reports') }]
      : []),
    ...(notes?.materials
      ? [{ key: 'materials', tone: 'orange' as const, title: `Ждут материалы: ${notes.materials}`, onPress: () => router.push({ pathname: '/requests', params: { lifecycle: 'materials' } }) }]
      : []),
    ...(notes?.pause_requests
      ? [{ key: 'pause', tone: 'orange' as const, title: `Запросы на приостановку: ${notes.pause_requests}`, onPress: () => router.push({ pathname: '/requests', params: { lifecycle: 'pause_request' } }) }]
      : []),
    ...(notes?.stale
      ? [{ key: 'stale', tone: 'orange' as const, title: `В работе дольше ${notes.stale_days ?? 3} раб. дн.: ${notes.stale}`, onPress: () => router.push({ pathname: '/requests', params: { lifecycle: 'stale' } }) }]
      : []),
  ];
  // Счётчики открытых заявок по статусам — для главной плашки «Заявки».
  const countsQ = useFocusQuery(
    requestCounts,
    { key: 'mhome:counts' },
  );
  const { data: counts } = countsQ;
  const awaitingQ = useFocusQuery(() => awaitingTotals(presetPeriod('month')), { key: 'mhome:awaiting' });
  const { data: awaiting } = awaitingQ;
  const ratingQ = useFocusQuery(managerRatingSummary, { key: 'mhome:ratings' });
  const { data: ratings } = ratingQ;
  const { autoStart } = useTour();
  const focused = useIsFocused();
  // первый вход на этом телефоне — обучение, после обновлений — «Что нового»
  useEffect(() => {
    if (focused && data) autoStart('manager', false);
  }, [focused, data, autoStart]);
  return (
    <Screen status={[dashQ, reviewQ, notesQ, countsQ, awaitingQ]} frame>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.hello}>{me?.displayName}</Text>
          <Text style={styles.sub}>МВСО</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Выйти" onPress={signOut} style={styles.round}>
          <Icon name="logout" size={iconSize.medium} />
        </Pressable>
      </View>

      <TourTarget id="mhome.month">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Сводка за месяц"
        onPress={() => router.push('/summary')}
        style={({ pressed }) => [styles.month, pressed && { opacity: opacity.soft }]}
      >
        <Text style={styles.monthLabel}>Выполнено за {monthName(storeToday())}</Text>
        <Text style={styles.monthSum}>{data ? formatKop(data.month_total_kop) : '…'}</Text>
        {data ? <Text style={styles.monthLabel}>заявок за месяц: {data.month_requests}</Text> : null}
        {awaiting?.entries ? (
          <Text style={styles.monthLabel}>
            ждут приёмки: {awaiting.entries} на {formatKop(awaiting.total_kop)} — в сумму не входят, пока заявки не приняты
          </Text>
        ) : null}
        {data?.pending_count ? (
          <View style={styles.warn}>
            <Text style={styles.warnText}>
              <Text style={styles.warnStrong}>{data.pending_count} на оценке</Text> — в сумму не входят
            </Text>
            <Icon name="chevronRight" size={iconSize.small} color={colors.white} />
          </View>
        ) : null}
        {ratings && ratings.count > 0 ? (
          <View style={styles.warn}>
            <Text style={styles.warnText}>
              <Text style={styles.warnStrong}>Рейтинг команды: ★ {ratings.avg?.toFixed(1).replace('.', ',')} из 5</Text>
              {' · '}{ratings.count} {pluralRatings(ratings.count)} за месяц
              {ratings.prev_count > 0 && ratings.prev_avg != null ? ` (в прошлом месяце ★ ${ratings.prev_avg.toFixed(1).replace('.', ',')})` : ''}
            </Text>
            <Icon name="chevronRight" size={iconSize.small} color={colors.white} />
          </View>
        ) : null}
      </Pressable>
      </TourTarget>

      <TourTarget id="mhome.requests">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Заявки"
          onPress={() => router.push('/requests')}
          style={({ pressed }) => [styles.req, pressed && { opacity: opacity.soft }]}
        >
          <Icon name="doc" size={iconSize.big} />
          <View style={styles.flex}>
            <Text style={styles.reqTitle}>Заявки</Text>
            <Text style={styles.reqSub}>
              {counts
                ? `Ожидают: ${counts.waiting} · В работе: ${counts.in_work} · На проверке: ${counts.review}${counts.paused ? ` · На паузе: ${counts.paused}` : ''}${counts.contractor ? ` · У подрядчика: ${counts.contractor}` : ''}`
                : 'Назначение, приоритет, проверка, план и факт'}
            </Text>
          </View>
          <Icon name="chevronRight" size={iconSize.medium} />
        </Pressable>
      </TourTarget>

      <TourTarget id="mhome.notices">
        <Notices items={notices} />
      </TourTarget>

      <Text style={styles.section}>Действия</Text>
      <View style={styles.grid}>
        <ActionTile tourId="mhome.review" title="На проверке" subtitle="заявки мастеров" icon="check" badge={review ?? undefined} href="/review" />
        <ActionTile tourId="mhome.pending" title="На оценке" subtitle="без цены" icon="clock" badge={data?.pending_count} href="/pending" />
        <ActionTile tourId="mhome.entries" title="Работы" subtitle="журнал и правка" icon="list" href="/entries" />
        <ActionTile tourId="mhome.export" title="В Excel" subtitle="отчёт за период" icon="download" href="/export" />
      </View>
      <Card style={styles.list}>
        <ListRow tourId="mhome.import" title="Загрузить заявки" subtitle="выгрузка из ITSM (Excel), раз в день" icon="upload" href="/import" />
        <ListRow tourId="mhome.reports" title="Сообщения от мастеров" subtitle="нет заявки на работу, просьбы «Передать подрядчику»" icon="doc" href="/reports" last />
      </Card>

      <Text style={styles.section}>Справочники</Text>
      <Card style={styles.list}>
        <ListRow title="Сотрудники" subtitle="учётные записи и пароли" icon="users" href="/employees" />
        <ListRow title="Прайс" subtitle="поиск, цены, включение позиций" icon="tag" href="/price" />
        <ListRow title="Отделы" subtitle="список для выбора мастером" icon="grid" href="/departments" last />
      </Card>
      <Card style={styles.list}>
        <ListRow
          title={notes?.feedback ? `Обратная связь: ${notes.feedback} новых` : 'Обратная связь'}
          subtitle="сообщения пользователей"
          icon="doc"
          href="/feedback"
        />
        <ListRow tourId="mhome.help" title="Помощь" subtitle="обучение по шагам и «Что нового»" icon="doc" href="/help" last />
      </Card>

      <Text style={styles.role}>Вы вошли как МВСО · {me?.login}</Text>
      <Text style={styles.role}>{appVersionLabel()}</Text>
    </Screen>
  );
}

/** Плитка действия: название сверху, жёлтый уголок со значком снизу справа. */
function ActionTile({ tourId, title, subtitle, icon, badge, href }: { tourId: string; title: string; subtitle: string; icon: IconName; badge?: number | null; href: Href }) {
  return (
    <TourTarget id={tourId} style={styles.tileBox}>
    <Pressable accessibilityRole="button" accessibilityLabel={badge ? `${title}: ${badge}` : title} onPress={() => router.push(href)} style={({ pressed }) => [styles.tile, pressed && { opacity: opacity.pressed }]}>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.sub}>{subtitle}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <View style={styles.corner} />
      <View style={styles.cornerIcon}>
        <Icon name={icon} size={iconSize.normal} />
      </View>
    </Pressable>
    </TourTarget>
  );
}

function ListRow({ tourId, title, subtitle, icon, href, last }: { tourId?: string; title: string; subtitle: string; icon: IconName; href: Href; last?: boolean }) {
  const row = (
    <Pressable accessibilityRole="button" onPress={() => router.push(href)} style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && { backgroundColor: colors.bg }]}>
      <Icon name={icon} size={iconSize.normal} />
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>
      <Icon name="chevronRight" size={iconSize.small} color={colors.muted} />
    </Pressable>
  );
  return tourId ? <TourTarget id={tourId}>{row}</TourTarget> : row;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.s10 },
  hello: { fontSize: font.title, fontWeight: '700' },
  sub: { fontSize: font.caption, color: colors.secondary },
  round: { width: touch.icon, height: touch.icon, borderRadius: radius.round, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  month: { gap: space.s4, backgroundColor: colors.black, borderRadius: radius.card, paddingHorizontal: space.s16, paddingVertical: space.s14 },
  monthLabel: { fontSize: font.small, color: colors.onDarkMuted },
  monthSum: { fontSize: font.sum, fontWeight: '800', color: colors.brand },
  warn: { marginTop: space.s6, minHeight: touch.small, borderRadius: radius.small, backgroundColor: colors.darkPanel, paddingHorizontal: space.s12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s8 },
  warnText: { flex: 1, fontSize: font.small, color: colors.white },
  warnStrong: { fontWeight: '700', color: colors.brand },
  req: { flexDirection: 'row', alignItems: 'center', gap: space.s12, backgroundColor: colors.brand, borderRadius: radius.card, paddingHorizontal: space.s16, paddingVertical: space.s16 },
  reqTitle: { fontSize: font.title, fontWeight: '800' },
  reqSub: { fontSize: font.small, fontWeight: '600', color: colors.black },
  section: { fontSize: font.text, fontWeight: '700', marginTop: space.s4, marginBottom: -space.s4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  tileBox: { width: '48.5%', flexGrow: 1 },
  tile: { width: '100%', height: size.tile, padding: space.s12, borderRadius: radius.card, backgroundColor: colors.card, overflow: 'hidden', gap: space.s2 },
  tileTitle: { fontSize: font.body, fontWeight: '700' },
  badge: { position: 'absolute', top: space.s10, right: space.s10, minWidth: size.tag, height: size.tag, borderRadius: radius.small, paddingHorizontal: space.s6, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: font.caption, fontWeight: '700' },
  corner: { position: 'absolute', right: -space.s12, bottom: 0, width: size.cornerWidth, height: size.cornerHeight, backgroundColor: colors.brand, transform: [{ skewX: '-25deg' }] },
  cornerIcon: { position: 'absolute', right: space.s12, bottom: space.s8 },
  list: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s12, minHeight: touch.big, paddingHorizontal: space.s12, paddingVertical: space.s6 },
  rowLine: { borderBottomWidth: stroke.hair, borderBottomColor: colors.bg },
  rowTitle: { fontSize: font.body, fontWeight: '600' },
  role: { textAlign: 'center', color: colors.secondary, fontSize: font.caption },
});
