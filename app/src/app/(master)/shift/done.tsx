import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { font, colors } from '../../../theme';

export default function DoneScreen() {
  const { entries, pending, edited } = useLocalSearchParams<{ entries: string; pending: string; edited: string }>();
  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>{edited === '1' ? 'Смена изменена' : 'Смена закрыта'}</Text>
        <Text style={styles.text}>Работ: {entries}</Text>
        {Number(pending) > 0 ? <Text style={styles.text}>Вне прайса, ждут оценки руководителя: {pending}</Text> : null}
        <Text style={styles.hint}>Исправить смену можно до конца сегодняшнего дня в разделе «Моя история».</Text>
      </Card>
      <BigButton title="На главную" size="big" onPress={() => router.dismissAll()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, alignItems: 'center', paddingVertical: 32 },
  title: { fontSize: font.header, fontWeight: '800' },
  text: { fontSize: font.body },
  hint: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
});
