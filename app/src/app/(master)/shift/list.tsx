import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { EntryCard } from '../../../components/EntryCard';
import { Screen } from '../../../components/Screen';
import { confirm } from '../../../lib/confirm';
import { formatDate } from '../../../lib/dates';
import { groupByRequest, useDraft } from '../../../lib/draft';
import { colors, font } from '../../../theme';

export default function ShiftListScreen() {
  const { draft, removeEntry, setRequest } = useDraft();
  if (!draft) {
    return (
      <Screen>
        <Text style={styles.empty}>Смена отправлена или черновик удалён.</Text>
        <BigButton title="На главную" onPress={() => router.dismissAll()} />
      </Screen>
    );
  }
  const groups = groupByRequest(draft.entries);

  return (
    <Screen>
      <Text style={styles.date}>
        {draft.editing ? 'Правка смены' : 'Смена'} за {formatDate(draft.workDate)} · работ: {draft.entries.length}
      </Text>
      {groups.length === 0 ? <Text style={styles.empty}>Пока нет ни одной работы.</Text> : null}
      {groups.map((g) => (
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
            onPress={() => {
              setRequest(g.request);
              router.push('/shift/work');
            }}
          />
        </View>
      ))}
      <BigButton title="+ Другая заявка" variant="secondary" onPress={() => router.push('/shift/request')} />
      <BigButton title="Проверить и отправить" size="big" disabled={!draft.entries.length} onPress={() => router.push('/shift/review')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  date: { fontSize: font.body, fontWeight: '700' },
  group: { gap: 10 },
  request: { fontSize: font.small, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', marginTop: 8 },
  empty: { color: colors.muted, fontSize: font.body },
});
