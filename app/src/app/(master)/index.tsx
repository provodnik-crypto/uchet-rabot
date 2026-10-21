import { router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppHeader, IconButton } from '../../components/AppHeader';
import { Avatar } from '../../components/Avatar';
import { BigButton } from '../../components/BigButton';
import { BottomTabs } from '../../components/BottomTabs';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { PriorityPill, StatusPill } from '../../components/StatusPill';
import { Text } from '../../components/Text';
import { useAuth } from '../../lib/auth';
import { confirm } from '../../lib/confirm';
import { formatDate } from '../../lib/dates';
import { useEmployeeIcons } from '../../lib/employeeIcons';
import { useLegacyDraft } from '../../lib/legacyDraft';
import { monthName } from '../../lib/manager';
import { formatKop } from '../../lib/money';
import { holdText, myNotifications, myRequests, openRequests, previewText, requestCard, requestLabel } from '../../lib/requests';
import { myEntries, myMonthSummary } from '../../lib/shift';
import { storeToday, takenDayNumber } from '../../lib/today';
import { TourTarget, useTour } from '../../lib/tour';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font, letterSpacing, lineHeight, opacity, radius, size, space, stroke, touch } from '../../theme';

/** Строка ленты «Что нового»: красная точка — вернули/отклонили/срочно, чёрная — сообщения и прочее. */
type FeedItem = { key: string; red?: boolean; title: string; text?: string | null; onPress: () => void };
const FEED_SHORT = 5;


/** «Добрый день» по времени магазина (Тюмень). */
function greeting(): string {
  const h = (new Date().getUTCHours() + 5) % 24;
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

export default function MasterHome() {
  const { me } = useAuth();
  const legacy = useLegacyDraft();
  const icons = useEmployeeIcons();
  const entriesQ = useFocusQuery(() => myEntries(14), { key: 'home:entries' });
  const monthQ = useFocusQuery(myMonthSummary, { key: 'home:month' });
  const mineQ = useFocusQuery(myRequests, { key: 'home:mine' });
  const notesQ = useFocusQuery(myNotifications, { key: 'home:notes' });
  // тот же список, что во вкладке «Заявки» (общий запас данных)
  const openQ = useFocusQuery(() => openRequests('', 'all'), { key: 'open:all:' });
  const active = mineQ.data?.find((m) => m.status === 'in_work' && m.responsible) ?? null;
  const cardQ = useFocusQuery(() => (active ? requestCard({ id: active.id }) : Promise.resolve(null)), {
    key: `card:${active?.id ?? 0}`,
    persist: false,
  });
  const [allFeed, setAllFeed] = useState(false);
  const { data: entries } = entriesQ;
  const { data: month } = monthQ;
  const { data: notes } = notesQ;
  const works = active && cardQ.data?.id === active.id ? cardQ.data.works.filter((w) => w.status !== 'rejected').length : null;
  const free = openQ.data?.filter((r) => r.status === 'waiting' && !r.to_contractor && (!r.assignee_id || r.mine)).length ?? null;
  const rejected = entries?.filter((e) => e.status === 'rejected').length ?? 0;

  const openCard = (id: number) => router.push({ pathname: '/req/[id]', params: { id: String(id) } });
  const sendActive = () => active && router.push({ pathname: '/req/send/[id]', params: { id: String(active.id) } });

  const feed: FeedItem[] = [
    ...(notes?.returned ?? [])
      .filter((n) => n.id !== active?.id)
      .map((n) => ({
        key: `r${n.id}`,
        red: true,
        title: `Вернули на доработку ${requestLabel(n.number)}`,
        text: n.queued ? `В очереди: станет активной, когда отправите текущую. ${n.comment}` : n.comment,
        onPress: () => openCard(n.id),
      })),
    ...(notes?.urgent ?? []).map((n) => ({
      key: `s${n.id}`,
      red: true,
      title: `Срочно: ${requestLabel(n.number)}`,
      text: n.status === 'in_work' ? `Ваша заявка · ${n.operation ?? ''}` : `Свободна · ${n.operation ?? ''}`,
      onPress: () => openCard(n.id),
    })),
    ...(Array.isArray(notes?.reports) ? notes.reports : []).map((n) => ({
      key: `m${n.id}`,
      red: n.status === 'rejected',
      title:
        n.status === 'request'
          ? `По вашему сообщению создана заявка ${requestLabel(n.request_number)}`
          : n.status === 'contractor'
            ? 'Заявку передали подрядчику'
            : n.status === 'closed'
              ? 'Заявку закрыли по вашей просьбе'
              : 'Руководитель ответил на ваше сообщение',
      text: n.status === 'rejected' ? `Отклонено: ${n.answer ?? '—'}` : n.answer ?? n.text,
      onPress: () => router.push('/req/report'),
    })),
    ...(notes?.unread ?? []).map((n) => ({
      key: `u${n.id}`,
      title: `Новое сообщение по ${requestLabel(n.number)}`,
      text: n.count > 1 ? `Новых: ${n.count}` : null,
      onPress: () => openCard(n.id),
    })),
    ...(rejected
      ? [{ key: 'rej', red: true, title: `Отклонено работ: ${rejected}`, text: 'Комментарий руководителя — в «Истории»', onPress: () => router.push('/history') }]
      : []),
    ...(mineQ.data ?? [])
      .filter((m) => m.id !== active?.id && !m.returned_comment && (m.status === 'paused' || !m.responsible))
      .map((m) => ({
        key: `p${m.id}`,
        title: m.responsible ? `${requestLabel(m.number)} приостановлена` : `Вы напарник: ${requestLabel(m.number)}`,
        text: m.responsible ? holdText(m.hold_reason, m.hold_number) : `Работы вносит ${m.responsible_name ?? 'мастер'}`,
        onPress: () => openCard(m.id),
      })),
  ];
  const shownFeed = allFeed ? feed : feed.slice(0, FEED_SHORT);

  const { autoStart } = useTour();
  const focused = useIsFocused();
  // Первый вход — обучение; уже работавшему мастеру после обновления — «Что нового».
  useEffect(() => {
    if (focused && entries && month) autoStart('master', entries.length > 0 || month.entries > 0 || month.pending > 0);
  }, [focused, entries, month, autoStart]);

  const returned = !!active?.returned_comment;
  const day = takenDayNumber(active?.taken_at ?? null);
  const sum = month ? formatKop(month.total_kop).replace(/\s?₽$/, '') : '…';

  return (
    <Screen
      status={[entriesQ, monthQ, mineQ, notesQ]}
      frame
      tabs
      footer={<BottomTabs />}
      header={
        <AppHeader>
          <View style={styles.hello}>
            {me ? <Avatar name={me.displayName} icon={icons[me.id]} size={touch.icon} dark /> : null}
            <View style={styles.flex}>
              <Text style={styles.greet}>{greeting()}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {me?.displayName.split(' ')[0]}
              </Text>
            </View>
            <TourTarget id="home.help">
              <IconButton icon="user" label="Профиль: помощь и выход" round onPress={() => router.push('/profile')} />
            </TourTarget>
          </View>
        </AppHeader>
      }
    >
      {/* ---------- Главная карточка: по ситуации ---------- */}
      {active ? (
        <TourTarget id="home.active">
          <View style={styles.main}>
            <View style={styles.mainHead}>
              <Text style={styles.caps}>МОЯ ЗАЯВКА СЕЙЧАС</Text>
              <View style={styles.pills}>
                <PriorityPill priority={active.priority} />
                {returned ? <StatusPill tone="returned" label="Вернули" /> : <StatusPill tone="in_work" label="В работе" />}
              </View>
            </View>
            <View style={styles.mainBody}>
              <Text style={styles.number} selectable>
                {requestLabel(active.number)}
              </Text>
              <Text style={styles.summary} numberOfLines={3}>
                {active.operation || previewText(active.description) || 'Без описания'}
              </Text>
              {returned ? <Text style={styles.returned}>Что исправить: {active.returned_comment}</Text> : null}
              <Text style={styles.meta}>
                {[works != null ? `Внесено работ: ${works}` : null, day ? `${day}-й день` : null].filter(Boolean).join(' · ') || 'В работе'}
              </Text>
              {active.pause_request ? <Text style={styles.meta}>Запрос на приостановку у руководителя</Text> : null}
            </View>
            {returned ? (
              <BigButton title="Исправить" variant="dark" size="big" onPress={() => openCard(active.id)} />
            ) : (
              <>
                <BigButton title="Продолжить" variant="dark" size="big" onPress={() => openCard(active.id)} />
                <BigButton title="Отправить на проверку" size="mid" disabled={works === 0} onPress={sendActive} />
                {works === 0 ? <Text style={styles.meta}>Чтобы отправить, добавьте хотя бы одну работу.</Text> : null}
              </>
            )}
          </View>
        </TourTarget>
      ) : (
        <TourTarget id="home.active">
          <View style={styles.main}>
            <Text style={styles.caps}>СЕЙЧАС ЗАЯВКИ В РАБОТЕ НЕТ</Text>
            <Text style={styles.number}>Свободных заявок: {free ?? '…'}</Text>
            <Text style={styles.meta}>Возьмите заявку — работы вносятся в её карточке.</Text>
            <BigButton title="Взять заявку" variant="dark" size="big" onPress={() => router.push('/req')} />
          </View>
        </TourTarget>
      )}

      {/* ---------- Сумма за месяц ---------- */}
      <TourTarget id="home.month">
        <Pressable onPress={() => router.push('/team')} accessibilityRole="button" style={({ pressed }) => [styles.month, pressed && styles.pressed]}>
          <View style={styles.monthRow}>
            <View style={styles.flex}>
              <Text style={styles.monthLabel}>Мои работы за {monthName(storeToday())}</Text>
              <Text style={styles.monthSum}>
                {sum} <Text style={styles.rub}>₽</Text>
              </Text>
            </View>
            <View style={styles.monthRight}>
              <Text style={styles.monthMeta}>Заявок: {month?.requests ?? '…'}</Text>
              <Text style={styles.monthMeta}>Работ: {month?.entries ?? '…'}</Text>
            </View>
          </View>
          {month?.pending || month?.awaiting ? (
            <Text style={styles.monthNote}>
              {[month.awaiting ? `ждут приёмки: ${month.awaiting}` : null, month.pending ? `на оценке: ${month.pending}` : null].filter(Boolean).join(' · ')}
              {' — добавятся позже'}
            </Text>
          ) : null}
        </Pressable>
      </TourTarget>

      {/* ---------- Что нового ---------- */}
      <TourTarget id="home.notices">
        <Section title="Что нового" right={feed.length > FEED_SHORT ? <FeedToggle all={allFeed} onPress={() => setAllFeed((x) => !x)} /> : null}>
          {shownFeed.length ? (
            shownFeed.map((n, i) => (
              <Pressable
                key={n.key}
                accessibilityRole="button"
                onPress={n.onPress}
                style={({ pressed }) => [styles.feedRow, i > 0 && styles.feedLine, pressed && styles.pressed]}
              >
                <View style={[styles.dot, n.red && styles.dotRed]} />
                <View style={styles.flex}>
                  <Text style={styles.feedTitle}>{n.title}</Text>
                  {n.text ? (
                    <Text style={styles.feedText} numberOfLines={2}>
                      {n.text}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))
          ) : (
            <Text style={styles.meta}>Новых событий нет</Text>
          )}
        </Section>
      </TourTarget>

      {/* ---------- Нет заявки на работу ---------- */}
      <View style={styles.extras}>
        <TourTarget id="req.planned">
          <BigButton title="Работа без заявки" variant="secondary" size="small" disabled={!!active} onPress={() => router.push('/req/new')} />
        </TourTarget>
        {active ? <Text style={styles.meta}>«Работа без заявки» — после отправки {requestLabel(active.number)} на проверку.</Text> : null}
        <TourTarget id="req.report">
          <BigButton title="Сообщить руководителю" variant="secondary" size="small" onPress={() => router.push('/req/report')} />
        </TourTarget>
      </View>

      {legacy.draft ? (
        <Section title="Старая смена">
          <Text style={styles.feedTitle}>
            Неотправленная смена за {formatDate(legacy.draft.workDate)} · работ: {legacy.draft.entries.length}
          </Text>
          <Text style={styles.meta}>
            {legacy.sending ? 'Отправляется…' : legacy.error ? `Не отправилась: ${legacy.error}` : 'Осталась от старой версии приложения — отправится сама.'}
          </Text>
          {legacy.error ? (
            <>
              <BigButton title="Повторить" size="small" onPress={legacy.retry} />
              <BigButton
                title="Удалить"
                size="small"
                variant="secondary"
                onPress={async () => {
                  if (await confirm('Удалить старую смену?', 'Работы из неё не попадут на сервер. Если они нужны — внесите их в заявке заново.', 'Удалить')) legacy.remove();
                }}
              />
            </>
          ) : null}
        </Section>
      ) : null}
    </Screen>
  );
}

function FeedToggle({ all, onPress }: { all: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={space.s12}>
      <Text style={styles.toggle}>{all ? 'Свернуть' : 'Все'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: opacity.pressed },
  hello: { flexDirection: 'row', alignItems: 'center', gap: space.s12 },
  greet: { fontSize: font.small },
  name: { fontSize: font.header, fontWeight: '700' },
  main: { backgroundColor: colors.card, borderRadius: radius.card, padding: space.s18, gap: space.s12 },
  mainHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s8 },
  pills: { flexDirection: 'row', gap: space.s6 },
  mainBody: { gap: space.s4 },
  caps: { fontSize: font.caption, fontWeight: '700', letterSpacing: letterSpacing.caps },
  number: { fontSize: font.number, fontWeight: '700' },
  summary: { fontSize: font.body, lineHeight: lineHeight.body },
  returned: { fontSize: font.small, fontWeight: '700', color: colors.danger },
  meta: { fontSize: font.small, color: colors.secondary },
  month: { backgroundColor: colors.black, borderRadius: radius.card, paddingVertical: space.s16, paddingHorizontal: space.s18, gap: space.s6 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: space.s12 },
  monthLabel: { fontSize: font.caption, color: colors.onDarkMuted },
  monthSum: { fontSize: font.sum, fontWeight: '700', color: colors.onDark },
  rub: { fontSize: font.header, color: colors.brand },
  monthRight: { alignItems: 'flex-end', gap: space.s2 },
  monthMeta: { fontSize: font.small, color: colors.onDark },
  monthNote: { fontSize: font.caption, color: colors.onDarkMuted },
  feedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s12, paddingVertical: space.s12 },
  feedLine: { borderTopWidth: stroke.hair, borderTopColor: colors.border },
  dot: { width: size.dot, height: size.dot, borderRadius: radius.round, backgroundColor: colors.black, marginTop: space.s6 },
  dotRed: { backgroundColor: colors.danger },
  feedTitle: { fontSize: font.list, fontWeight: '700' },
  feedText: { fontSize: font.small, color: colors.secondary },
  extras: { gap: space.s8 },
  toggle: { fontSize: font.small, fontWeight: '700', textDecorationLine: 'underline' },
});
