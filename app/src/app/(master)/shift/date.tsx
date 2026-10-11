import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Screen } from '../../../components/Screen';
import { formatDate } from '../../../lib/dates';
import { useDraft } from '../../../lib/draft';
import { storeToday, storeYesterday } from '../../../lib/today';
import { colors, font } from '../../../theme';

export default function ShiftDateScreen() {
  const { start } = useDraft();
  const pick = (date: string) => {
    start(date);
    router.replace('/shift/request');
  };
  return (
    <Screen>
      <Text style={styles.q}>За какой день вносите работы?</Text>
      <BigButton title={`Сегодня · ${formatDate(storeToday())}`} size="big" onPress={() => pick(storeToday())} />
      <BigButton title={`Вчера · ${formatDate(storeYesterday())}`} variant="secondary" size="big" onPress={() => pick(storeYesterday())} />
      <Text style={styles.hint}>Более ранние дни вносит руководитель.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  q: { fontSize: font.title, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: font.small, textAlign: 'center' },
});
