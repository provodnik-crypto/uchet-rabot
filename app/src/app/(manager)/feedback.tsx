import { StyleSheet, View } from 'react-native';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { Text } from '../../components/Text';
import { developerFeedbackList, developerFeedbackMarkRead } from '../../lib/feedback';
import { formatStoreTime } from '../../lib/requests';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font, space, stroke } from '../../theme';

/** Обратная связь (только аккаунт разработчика, логин 60133303): сообщения пользователей.
 *  Открыл список — все сообщения прочитаны (счётчик на главной гаснет). */
export default function FeedbackListScreen() {
  const query = useFocusQuery(
    async () => {
      const list = await developerFeedbackList();
      if (list.some((m) => !m.read_at)) await developerFeedbackMarkRead().catch(() => null);
      return list;
    },
    { key: 'developer-feedback', persist: false },
  );
  const { data: list, error, loading, reload } = query;
  return (
    <Screen status={query}>
      {!list ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {list && !list.length ? <Text style={styles.meta}>Сообщений пока нет.</Text> : null}
      {list?.map((m) => (
        <Card key={m.id} style={[styles.card, !m.read_at && styles.unread]}>
          <Text style={styles.meta}>
            {m.author} · {formatStoreTime(m.created_at)}
            {!m.read_at ? ' · новое' : ''}
          </Text>
          <Text style={styles.body}>{m.body}</Text>
        </Card>
      ))}
      <View style={styles.spacer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s8 },
  unread: { borderWidth: stroke.outline, borderColor: colors.brand },
  meta: { fontSize: font.small, color: colors.muted },
  body: { fontSize: font.body },
  spacer: { height: space.s16 },
});
