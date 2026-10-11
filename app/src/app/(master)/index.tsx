import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Tile } from '../../components/Tile';
import { useAuth } from '../../lib/auth';
import { confirm } from '../../lib/confirm';
import { formatDate } from '../../lib/dates';
import { useDraft } from '../../lib/draft';
import { usePhotoUrls } from '../../lib/photos';
import { myEntries } from '../../lib/shift';
import { goToShiftList } from '../../lib/shiftNav';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font } from '../../theme';

export default function MasterHome() {
  const { me, signOut } = useAuth();
  const { ready, draft, clear } = useDraft();
  const photos = usePhotoUrls();
  const { data: entries } = useFocusQuery(() => myEntries(14));
  const rejected = entries?.filter((e) => e.status === 'rejected').length ?? 0;
  const hasDraft = !!draft && draft.entries.length > 0;

  return (
    <Screen>
      <View style={styles.helloRow}>
        {me ? <Avatar name={me.displayName} uri={photos[me.id]} size={64} /> : null}
        <Text style={styles.hello}>Здравствуйте, {me?.displayName.split(' ')[0]}!</Text>
      </View>

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

      <Tile title="Моя история" subtitle="Внесённые работы и их статусы" onPress={() => router.push('/history')} />
      <BigButton title="Выйти" variant="secondary" onPress={signOut} />
      <Text style={styles.role}>Вы вошли как мастер · {me?.login}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  helloRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hello: { fontSize: font.header, fontWeight: '800', flex: 1 },
  alert: { borderWidth: 2, borderColor: colors.danger, gap: 4 },
  alertTitle: { fontSize: font.body, fontWeight: '800', color: colors.danger },
  alertText: { fontSize: font.small, color: colors.muted },
  draftNote: { textAlign: 'center', color: colors.muted, fontSize: font.small, marginTop: -8 },
  role: { textAlign: 'center', color: colors.muted, fontSize: font.small },
});
