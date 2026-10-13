import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { EntryCard } from '../../../components/EntryCard';
import { RequestTimeCard } from '../../../components/RequestTimeCard';
import { Screen } from '../../../components/Screen';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { shiftGroups, useDraft } from '../../../lib/draft';
import { formatMinutes, SHIFT_MINUTES } from '../../../lib/requestTime';
import { useRequestInfo } from '../../../lib/useRequestInfo';
import { TourTarget } from '../../../lib/tour';
import { colors, font } from '../../../theme';

export default function ShiftListScreen() {
  const { draft, removeEntry, setRequest, setRequestTime } = useDraft();
  const info = useRequestInfo(draft);
  if (!draft) {
    return (
      <Screen>
        <Text style={styles.empty}>Смена отправлена или черновик удалён.</Text>
        <BigButton title="На главную" onPress={() => router.dismissAll()} />
      </Screen>
    );
  }
  const groups = shiftGroups(draft);
  const total = groups.reduce((a, g) => a + (g.time.minutes ?? 0), 0);

  return (
    <Screen>
      <Text style={styles.date}>
        {draft.editing ? 'Итог дня (уже отправлялся)' : 'Итог дня'} за {formatDate(draft.workDate)} · работ: {draft.entries.length}
      </Text>
      <Text style={[styles.total, total > SHIFT_MINUTES && styles.warn]}>
        Время за смену: {formatMinutes(total)} из {formatMinutes(SHIFT_MINUTES)}
        {total > SHIFT_MINUTES ? ' — больше смены, проверьте' : ''}
      </Text>
      {groups.length === 0 ? <Text style={styles.empty}>Пока нет ни одной работы.</Text> : null}
      {groups.map((g, gi) => (
        <View key={g.request ?? '—'} style={styles.group}>
          <Text style={styles.request}>{g.request ? `Заявка ${g.request}` : 'Без заявки'}</Text>
          {g.entries.map((e) => (
            <EntryCard
              key={e.key}
              name={e.name}
              category={e.category}
              isCustom={!e.priceItemId}
              quantity={e.quantity}
              unitCode={e.unitCode}
              department={e.departmentName}
              performers={e.performerNames.join(', ')}
              note={e.note}
              photos={e.photos?.length}
              onPress={() => router.push({ pathname: '/shift/entry', params: { key: e.key } })}
              onRemove={async () => {
                if (await confirm('Удалить работу?', e.name, 'Удалить')) removeEntry(e.key);
              }}
            />
          ))}
          <BigButton
            title={g.request ? `+ Работа по ${g.request}` : '+ Работа без заявки'}
            variant="secondary"
            size="small"
            onPress={() => {
              setRequest(g.request);
              router.push('/shift/work');
            }}
          />
          <RequestTimeCard tour={gi === 0} time={g.time} info={g.request ? info[g.request] : undefined} onChange={(p) => setRequestTime(g.request, p)} />
        </View>
      ))}
      <TourTarget id="list.addRequest">
        <BigButton title="+ Другая заявка" variant="secondary" size="small" onPress={() => router.push('/shift/request')} />
      </TourTarget>
      <TourTarget id="list.review">
      <BigButton
        title="Закрыть смену"
        size="big"
        disabled={!draft.entries.length && !groups.some((g) => (g.time.minutes ?? 0) > 0)}
        onPress={() => router.push('/shift/review')}
      />
      </TourTarget>
    </Screen>
  );
}

const styles = StyleSheet.create({
  date: { fontSize: font.body, fontWeight: '700' },
  total: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  warn: { color: colors.danger, fontWeight: '800' },
  group: { gap: 6 },
  request: { fontSize: font.small, fontWeight: '700', color: colors.secondary, marginTop: 6 },
  empty: { color: colors.muted, fontSize: font.body },
});
