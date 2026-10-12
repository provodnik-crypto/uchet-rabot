import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Tile } from '../../components/Tile';
import { appVersionLabel } from '../../lib/appUpdate';
import { useAuth } from '../../lib/auth';
import { managerDashboard, monthName } from '../../lib/manager';
import { formatKop } from '../../lib/money';
import { storeToday } from '../../lib/today';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font } from '../../theme';

export default function ManagerHome() {
  const { me, signOut } = useAuth();
  const { data } = useFocusQuery(managerDashboard);
  return (
    <Screen>
      <Text style={styles.hello}>{me?.displayName}</Text>
      <Card style={styles.month}>
        <Text style={styles.monthLabel}>Выполнено за {monthName(storeToday())}</Text>
        <Text style={styles.monthSum}>{data ? formatKop(data.month_total_kop) : '…'}</Text>
        {data ? <Text style={styles.monthMeta}>работ с ценой: {data.month_entries}</Text> : null}
        {data?.pending_count ? <Text style={styles.warn}>Без цены (на оценке): {data.pending_count} — в сумму не входят</Text> : null}
      </Card>
      <Tile title="На оценке" subtitle="Работы вне прайса без цены" badge={data?.pending_count} onPress={() => router.push('/pending')} />
      <Tile title="Работы" subtitle="Журнал с фильтрами, правка записей" onPress={() => router.push('/entries')} />
      <Tile title="Сводка" subtitle="Выработка по сотрудникам и месяцам" onPress={() => router.push('/summary')} />
      <Tile title="Время" subtitle="Время по видам работ и мастерам, перенос, план" onPress={() => router.push('/time')} />
      <Tile title="Выгрузить в Excel" subtitle="Отчёт с диаграммами за период" onPress={() => router.push('/export')} />
      <Text style={styles.section}>Справочники</Text>
      <Tile title="Заявки" subtitle="Тема, план и факт по времени" onPress={() => router.push('/requests')} />
      <Tile title="Сотрудники" subtitle="Учётные записи и пароли" onPress={() => router.push('/employees')} />
      <Tile title="Прайс" subtitle="Поиск, цены, включение позиций" onPress={() => router.push('/price')} />
      <Tile title="Отделы" subtitle="Список для выбора мастером" onPress={() => router.push('/departments')} />
      <BigButton title="Выйти" variant="secondary" onPress={signOut} />
      <Text style={styles.role}>Вы вошли как руководитель · {me?.login}</Text>
      <Text style={styles.role}>{appVersionLabel()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: { fontSize: font.header, fontWeight: '800' },
  month: { gap: 4, backgroundColor: colors.black },
  monthLabel: { fontSize: font.small, color: '#BBBBBB' },
  monthSum: { fontSize: 34, fontWeight: '800', color: colors.brand },
  monthMeta: { fontSize: font.small, color: '#BBBBBB' },
  warn: { fontSize: font.small, color: '#FFFFFF', fontWeight: '700', marginTop: 4 },
  section: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 8 },
  role: { textAlign: 'center', color: colors.muted, fontSize: font.small },
});
