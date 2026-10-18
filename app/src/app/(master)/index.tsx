import { router, useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Icon } from '../../components/Icon';
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
import { myNotifications, myRequests, myRequestsBadge, requestLabel } from '../../lib/requests';
import { Notices, type Notice } from '../../components/Notices';
import { formatMinutes, formatPlan } from '../../lib/requestTime';
import { RequestBadges } from '../../components/RequestBadges';
import { myEntries, myMonthSummary, myOpenRequests } from '../../lib/shift';
import { storeToday } from '../../lib/today';
import { TourTarget, useTour } from '../../lib/tour';
import { openShiftList } from '../../lib/shiftNav';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font } from '../../theme';
import { DueLine } from '../../components/DueLine';

export default function MasterHome() {
  const { me, signOut } = useAuth();
  const { ready, draft, clear } = useDraft();
  const icons = useEmployeeIcons();
  const { data: entries } = useFocusQuery(() => myEntries(14));
  const { data: month } = useFocusQuery(myMonthSummary);
  const rejected = entries?.filter((e) => e.status === 'rejected').length ?? 0;
  const { data: open } = useFocusQuery(myOpenRequests);
  const { data: badge } = useFocusQuery(() => (me ? myRequestsBadge(me.id) : Promise.resolve(null)));
  const { data: mineList } = useFocusQuery(myRequests);
  const { data: notes } = useFocusQuery(myNotifications);
  const openCard = (id: number) => router.push({ pathname: '/req/[id]', params: { id: String(id) } });
  const notices: Notice[] = [
    ...(notes?.returned ?? []).map((n) => ({ key: `r${n.id}`, tone: 'red' as const, title: `Вернули ${requestLabel(n.number)}`, text: n.comment, onPress: () => openCard(n.id) })),
    ...(notes?.unread ?? []).map((n) => ({ key: `u${n.id}`, tone: 'blue' as const, title: `Новое по заявке ${requestLabel(n.number)}`, text: `Сообщений и событий: ${n.count}`, onPress: () => openCard(n.id) })),
    ...(notes?.urgent ?? []).map((n) => ({
      key: `s${n.id}`,
      tone: 'red' as const,
      title: `● Срочно: ${requestLabel(n.number)}`,
      text: n.status === 'in_work' ? `Ваша заявка · ${n.operation ?? ''}` : `Свободна · ${n.operation ?? ''}`,
      onPress: () => openCard(n.id),
    })),
  ];
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
        {month?.awaiting ? <Text style={styles.monthMeta}>Работ по заявкам ждут приёмки: {month.awaiting} — добавятся, когда руководитель примет</Text> : null}
        <Text style={styles.monthLink}>Рейтинг команды →</Text>
      </Card>
      </TourTarget>

      <TourTarget id="home.notices">
        <Notices items={notices} />
      </TourTarget>

      {mineList?.length ? (
        <TourTarget id="home.mine" style={styles.mineBox}>
          <Text style={styles.section}>Мои заявки</Text>
          {mineList.map((r) => (
            <Card
              key={r.id}
              style={[styles.mineCard, r.returned_comment ? styles.mineReturned : null]}
              onPress={() => router.push({ pathname: '/req/[id]', params: { id: String(r.id) } })}
            >
              <RequestBadges status={r.status === 'in_work' ? 'waiting' : r.status} priority={r.priority} unread={r.unread} />
              <Text style={styles.mineNumber}>
                {requestLabel(r.number)}
                {r.operation ? <Text style={styles.mineOp}> · {r.operation}</Text> : null}
              </Text>
              <DueLine dueAt={r.due_at} status={r.status} />
              <Text style={styles.mineMeta}>
                {r.returned_comment
                  ? `Вернули: ${r.returned_comment}`
                  : r.status === 'review'
                    ? 'На проверке у руководителя'
                    : `${r.responsible ? '' : `Взял ${r.responsible_name} · вы напарник · `}${formatMinutes(r.spent_minutes)}${r.plan_minutes != null ? ` из ~${formatPlan(r.plan_minutes)}` : ''}`}
              </Text>
            </Card>
          ))}
        </TourTarget>
      ) : null}

      {rejected ? (
        <Card onPress={() => router.push('/history')} style={styles.alert}>
          <Text style={styles.alertTitle}>Отклонено работ: {rejected}</Text>
          <Text style={styles.alertText}>Посмотрите комментарий руководителя в истории</Text>
        </Card>
      ) : null}

      {hasDraft ? (
        <>
          <TourTarget id="home.shift">
            <BigButton title={`Продолжить смену · ${draft.entries.length}`} size="big" onPress={openShiftList} />
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

      <TourTarget id="home.requests">
        <Card style={[styles.reqCard, badge?.assigned ? styles.reqMine : null]} onPress={() => router.push('/req')}>
          <View style={styles.reqRow}>
            <View style={styles.reqText}>
              <Text style={styles.reqTitle}>Заявки</Text>
              <Text style={styles.reqSub}>
                {badge ? `Назначено вам: ${badge.assigned} · Новые: ${badge.fresh}` : 'Открытые заявки магазина'}
              </Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.secondary} strokeWidth={2.4} />
          </View>
        </Card>
      </TourTarget>

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
  section: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  mineBox: { gap: 6 },
  mineCard: { gap: 3, borderLeftWidth: 4, borderLeftColor: colors.brand },
  mineReturned: { borderLeftColor: colors.danger },
  mineNumber: { fontSize: font.body, fontWeight: '800' },
  mineOp: { fontWeight: '600' },
  mineMeta: { fontSize: font.small, color: colors.secondary },
  reqCard: { minHeight: 56, justifyContent: 'center' },
  reqMine: { borderWidth: 2, borderColor: colors.brand },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqText: { flex: 1, gap: 2 },
  reqTitle: { fontSize: font.body, fontWeight: '700' },
  reqSub: { fontSize: font.small, color: colors.secondary },
  role: { textAlign: 'center', color: colors.muted, fontSize: font.small },
});
