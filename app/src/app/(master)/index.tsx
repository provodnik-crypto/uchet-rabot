import { router, useIsFocused } from 'expo-router';
import { useEffect } from 'react';
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
import { myEntries, myMonthSummary, myOpenRequests } from '../../lib/shift';
import { storeToday } from '../../lib/today';
import { TourTarget, useTour } from '../../lib/tour';
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
  const { data: open } = useFocusQuery(myOpenRequests);
  const hasDraft = !!draft && (draft.entries.length > 0 || !!draft.requests?.some((r) => r.minutes));
  const { autoStart } = useTour();
  const focused = useIsFocused();
  // Первый вход — обучение; уже работавшему мастеру после обновления — «Что нового».
  useEffect(() => {
    if (focused && entries && month) autoStart('master', entries.length > 0 || month.entries > 0 || month.pending > 0);
  }, [focused, entries, month, autoStart]);

  return (
    <Screen>
      <View style={styles.helloRow}>
        {me ? <Avatar name={me.displayName} icon={icons[me.id]} size={44} /> : null}
        <Text style={styles.hello}>Здравствуйте, {me?.displayName.split(' ')[0]}!</Text>
      </View>

      <TourTarget id="home.month">
      <Card style={styles.month} onPress={() => router.push('/team')}>
        <Text style={styles.monthLabel}>Мои работы за {monthName(storeToday())}</Text>
        <Text style={styles.monthSum}>{month ? formatKop(month.total_kop) : '…'}</Text>
        <Text style={styles.monthMeta}>
          Выполнено заявок: {month?.requests ?? '…'} · работ: {month?.entries ?? '…'}
        </Text>
        {month?.pending ? <Text style={styles.monthMeta}>Ещё на оценке: {month.pending} — добавятся после оценки</Text> : null}
        <Text style={styles.monthLink}>Рейтинг команды →</Text>
      </Card>
      </TourTarget>

      {rejected ? (
        <Card onPress={() => router.push('/history')} style={styles.alert}>
          <Text style={styles.alertTitle}>Отклонено работ: {rejected}</Text>
          <Text style={styles.alertText}>Посмотрите комментарий руководителя в истории</Text>
        </Card>
      ) : null}

      {hasDraft ? (
        <>
          <TourTarget id="home.shift">
            <BigButton title={`Продолжить смену · ${draft.entries.length}`} size="big" onPress={goToShiftList} />
          </TourTarget>
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
        <>
          <TourTarget id="home.shift" style={styles.shiftBox}>
            <BigButton title="Закрыть смену" size="big" disabled={!ready} onPress={() => router.push('/shift/date')} />
            {open?.length ? (
              <Text style={styles.openNote}>
                Не закончено: {open.map((r) => `${r.number} (с ${formatDate(r.since).slice(0, 5)})`).join(', ')} — будет вверху смены
              </Text>
            ) : null}
          </TourTarget>
        </>
      )}

      <Tile title="Команда" subtitle="Рейтинг и суммы по месяцам" onPress={() => router.push('/team')} />
      <TourTarget id="home.history">
        <Tile title="Моя история" subtitle="Внесённые работы и их статусы" onPress={() => router.push('/history')} />
      </TourTarget>
      <TourTarget id="home.help">
        <Tile title="Помощь" subtitle="Обучение по шагам и «Что нового»" onPress={() => router.push('/help')} />
      </TourTarget>
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
  monthSum: { fontSize: 30, fontWeight: '800', color: colors.brand },
  monthMeta: { fontSize: font.small, color: '#DDDDDD' },
  monthLink: { fontSize: font.small, color: colors.brand, fontWeight: '700', marginTop: 4 },
  alert: { borderWidth: 1.5, borderColor: colors.danger, gap: 4 },
  alertTitle: { fontSize: font.body, fontWeight: '800', color: colors.danger },
  alertText: { fontSize: font.small, color: colors.muted },
  draftNote: { textAlign: 'center', color: colors.muted, fontSize: font.small, marginTop: -8 },
  shiftBox: { gap: 4 },
  openNote: { textAlign: 'center', color: colors.muted, fontSize: font.small },
  role: { textAlign: 'center', color: colors.muted, fontSize: font.small },
});
