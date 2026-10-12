import { router, useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { Icon, type IconName } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { appVersionLabel } from '../../lib/appUpdate';
import { useAuth } from '../../lib/auth';
import { managerDashboard, monthName } from '../../lib/manager';
import { formatKop } from '../../lib/money';
import { storeToday } from '../../lib/today';
import { TourTarget, useTour } from '../../lib/tour';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font, radius, touch } from '../../theme';

type Href = Parameters<typeof router.push>[0];

export default function ManagerHome() {
  const { me, signOut } = useAuth();
  const { data } = useFocusQuery(managerDashboard);
  const { autoStart } = useTour();
  const focused = useIsFocused();
  // первый вход на этом телефоне — обучение, после обновлений — «Что нового»
  useEffect(() => {
    if (focused && data) autoStart('manager', false);
  }, [focused, data, autoStart]);
  return (
    <Screen>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.hello}>{me?.displayName}</Text>
          <Text style={styles.sub}>Руководитель</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Выйти" onPress={signOut} style={styles.round}>
          <Icon name="logout" size={20} />
        </Pressable>
      </View>

      <TourTarget id="mhome.month">
      <Card style={styles.month}>
        <Text style={styles.monthLabel}>Выполнено за {monthName(storeToday())}</Text>
        <Text style={styles.monthSum}>{data ? formatKop(data.month_total_kop) : '…'}</Text>
        {data ? <Text style={styles.monthLabel}>работ с ценой: {data.month_entries}</Text> : null}
        {data?.pending_count ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/pending')} style={styles.warn}>
            <Text style={styles.warnText}>
              <Text style={styles.warnStrong}>{data.pending_count} на оценке</Text> — в сумму не входят
            </Text>
            <Icon name="chevronRight" size={16} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </Card>
      </TourTarget>

      <Text style={styles.section}>Действия</Text>
      <View style={styles.grid}>
        <ActionTile tourId="mhome.pending" title="На оценке" subtitle="без цены" icon="clock" badge={data?.pending_count} href="/pending" />
        <ActionTile tourId="mhome.entries" title="Работы" subtitle="журнал и правка" icon="list" href="/entries" />
        <ActionTile tourId="mhome.summary" title="Сводка" subtitle="по сотрудникам" icon="chart" href="/summary" />
        <ActionTile tourId="mhome.export" title="В Excel" subtitle="отчёт за период" icon="download" href="/export" />
      </View>
      <Card style={styles.list}>
        <ListRow tourId="mhome.time" title="Время" subtitle="по видам работ и мастерам, перенос, план" icon="clock" href="/time" last />
      </Card>

      <Text style={styles.section}>Справочники</Text>
      <Card style={styles.list}>
        <ListRow tourId="mhome.requests" title="Заявки" subtitle="тема, план и факт по времени" icon="doc" href="/requests" />
        <ListRow title="Сотрудники" subtitle="учётные записи и пароли" icon="users" href="/employees" />
        <ListRow title="Прайс" subtitle="поиск, цены, включение позиций" icon="tag" href="/price" />
        <ListRow title="Отделы" subtitle="список для выбора мастером" icon="grid" href="/departments" last />
      </Card>
      <Card style={styles.list}>
        <ListRow tourId="mhome.help" title="Помощь" subtitle="обучение по шагам и «Что нового»" icon="doc" href="/help" last />
      </Card>

      <Text style={styles.role}>Вы вошли как руководитель · {me?.login}</Text>
      <Text style={styles.role}>{appVersionLabel()}</Text>
    </Screen>
  );
}

/** Плитка действия: название сверху, жёлтый уголок со значком снизу справа. */
function ActionTile({ tourId, title, subtitle, icon, badge, href }: { tourId: string; title: string; subtitle: string; icon: IconName; badge?: number | null; href: Href }) {
  return (
    <TourTarget id={tourId} style={styles.tileBox}>
    <Pressable accessibilityRole="button" accessibilityLabel={badge ? `${title}: ${badge}` : title} onPress={() => router.push(href)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.sub}>{subtitle}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <View style={styles.corner} />
      <View style={styles.cornerIcon}>
        <Icon name={icon} size={24} fill="#FFFFFF" strokeWidth={1.8} />
      </View>
    </Pressable>
    </TourTarget>
  );
}

function ListRow({ tourId, title, subtitle, icon, href, last }: { tourId?: string; title: string; subtitle: string; icon: IconName; href: Href; last?: boolean }) {
  const row = (
    <Pressable accessibilityRole="button" onPress={() => router.push(href)} style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && { backgroundColor: colors.bg }]}>
      <Icon name={icon} size={22} strokeWidth={1.8} />
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>
      <Icon name="chevronRight" size={16} color={colors.muted} strokeWidth={2.4} />
    </Pressable>
  );
  return tourId ? <TourTarget id={tourId}>{row}</TourTarget> : row;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hello: { fontSize: font.title, fontWeight: '700' },
  sub: { fontSize: font.small - 1, color: colors.secondary },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  month: { gap: 4, backgroundColor: colors.black, paddingHorizontal: 16, paddingVertical: 14 },
  monthLabel: { fontSize: font.small, color: '#C8C8C8' },
  monthSum: { fontSize: 30, fontWeight: '800', color: colors.brand },
  warn: { marginTop: 6, minHeight: 40, borderRadius: 8, backgroundColor: '#1F1F1F', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  warnText: { flex: 1, fontSize: font.small, color: '#FFFFFF' },
  warnStrong: { fontWeight: '700', color: colors.brand },
  section: { fontSize: font.body + 2, fontWeight: '700', marginTop: 4, marginBottom: -4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tileBox: { width: '48.5%', flexGrow: 1 },
  tile: { width: '100%', height: 92, padding: 12, borderRadius: radius.card, backgroundColor: colors.card, overflow: 'hidden', gap: 2 },
  tileTitle: { fontSize: font.body, fontWeight: '700' },
  badge: { position: 'absolute', top: 10, right: 10, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: font.small - 1, fontWeight: '700' },
  corner: { position: 'absolute', right: -12, bottom: 0, width: 80, height: 30, backgroundColor: colors.brand, transform: [{ skewX: '-25deg' }] },
  cornerIcon: { position: 'absolute', right: 12, bottom: 8 },
  list: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.big, paddingHorizontal: 12, paddingVertical: 6 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.bg },
  rowTitle: { fontSize: font.body, fontWeight: '600' },
  role: { textAlign: 'center', color: colors.secondary, fontSize: font.small - 1 },
});
