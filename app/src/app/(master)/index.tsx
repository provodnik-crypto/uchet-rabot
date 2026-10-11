import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Tile } from '../../components/Tile';
import { appVersionLabel } from '../../lib/appUpdate';
import { useAuth } from '../../lib/auth';
import { confirm } from '../../lib/confirm';
import { formatDate } from '../../lib/dates';
import { useDraft } from '../../lib/draft';
import { useEmployeeIcons } from '../../lib/employeeIcons';
import { formatKop } from '../../lib/money';
import { monthName } from '../../lib/manager';
import { myEntries, myMonthSummary } from '../../lib/shift';
import { storeToday } from '../../lib/today';
import { goToShiftList } from '../../lib/shiftNav';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font } from '../../theme';

export default function MasterHome() {
  const { me, signOut } = useAuth();
  const { ready, draft, clear } = useDraft();
  const icons = useEmployeeIcons();
  const { data: entries } = useFocusQuery(() => myEntries(14));
  const { data: month } = useFocusQuery(myMonthSummary);
  const rejected = entries?.filter((e) => e.status === 'rejected').length ?? 0;
  const hasDraft = !!draft && draft.entries.length > 0;

  return (
    <Screen>
      <View style={styles.helloRow}>
        {me ? <Avatar name={me.displayName} icon={icons[me.id]} size={64} /> : null}
        <Text style={styles.hello}>Здравствуйте, {me?.displayName.split(' ')[0]}!</Text>
      </View>

      <Card style={styles.month} onPress={() => router.push('/team')}>
        <Text style={styles.monthLabel}>Мои работы за {monthName(storeToday())}</Text>
        <Text style={styles.monthSum}>{month ? formatKop(month.total_kop) : '…'}</Text>
        <Text style={styles.monthMeta}>
          Выполнено заявок: {month?.requests ?? '…'} · работ: {month?.entries ?? '…'}
        </Text>
        {month?.pending ? <Text style={styles.monthMeta}>Ещё на оценке: {month.pending} — добавятся после оценки</Text> : null}
        <Text style={styles.monthLink}>Рейтинг команды →</Text>
      </Card>

      {rejected ? (
        <Card onPress={() => router.push('/history')} style={styles.alert}>
          <Text style={styles.alertTitle}>Отклонено работ: {rejected}</Text>
          <Text style={styles.alertText}>Посмотрите комментарий руководителя в истории</Text>
        </Card>
      ) : null}

      {hasDraft ? (
        <>
          <BigButton title={`Продолжить смену · ${draft.entries.length}`} size="big" onPress={goToShiftList} />
          <Text style={styles.draftNote}>
            {draft.editing ? 'Правка отправленной смены' : 'Черновик не отправлен'} · {formatDate(draft.workDate)}
          </Text>
          <BigButton
            title="Удалить черновик"
            variant="secondary"
            onPress={async () => {
              if (await confirm('Удалить черновик?', 'Внесённые, но не отправленные работы пропадут.', 'Удалить')) clear();
            }}
          />
        </>
      ) : (
        <BigButton title="Закрыть смену" size="big" disabled={!ready} onPress={() => router.push('/shift/date')} />
      )}

      <Tile title="Команда" subtitle="Рейтинг и суммы по месяцам" onPress={() => router.push('/team')} />
      <Tile title="Моя история" subtitle="Внесённые работы и их статусы" onPress={() => router.push('/history')} />
      <BigButton title="Выйти" variant="secondary" onPress={signOut} />
      <Text style={styles.role}>Вы вошли как мастер · {me?.login}</Text>
      <Text style={styles.role}>{appVersionLabel()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  helloRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hello: { fontSize: font.header, fontWeight: '800', flex: 1 },
  month: { gap: 4, backgroundColor: colors.black },
  monthLabel: { fontSize: font.small, color: '#BBBBBB' },
  monthSum: { fontSize: 34, fontWeight: '800', color: colors.brand },
  monthMeta: { fontSize: font.small, color: '#DDDDDD' },
  monthLink: { fontSize: font.small, color: colors.brand, fontWeight: '700', marginTop: 4 },
  alert: { borderWidth: 2, borderColor: colors.danger, gap: 4 },
  alertTitle: { fontSize: font.body, fontWeight: '800', color: colors.danger },
  alertText: { fontSize: font.small, color: colors.muted },
  draftNote: { textAlign: 'center', color: colors.muted, fontSize: font.small, marginTop: -8 },
  role: { textAlign: 'center', color: colors.muted, fontSize: font.small },
});
