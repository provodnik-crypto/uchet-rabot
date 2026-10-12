import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Screen } from '../../../components/Screen';
import { formatDate } from '../../../lib/dates';
import { useDraft } from '../../../lib/draft';
import { myOpenRequests } from '../../../lib/shift';
import { storeToday, storeYesterday } from '../../../lib/today';
import { colors, font } from '../../../theme';

export default function ShiftDateScreen() {
  const { start } = useDraft();
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (date: string) => {
    setBusy(date);
    // Незаконченные заявки прошлых смен встают в начало списка. Нет связи — начинаем без них.
    const carried = await myOpenRequests().catch(() => []);
    setBusy(null);
    start(date, carried);
    router.replace(carried.length ? '/shift/list' : '/shift/request');
  };
  return (
    <Screen>
      <Text style={styles.q}>За какой день вносите работы?</Text>
      <BigButton title={`Сегодня · ${formatDate(storeToday())}`} size="big" loading={busy === storeToday()} disabled={!!busy} onPress={() => pick(storeToday())} />
      <BigButton
        title={`Вчера · ${formatDate(storeYesterday())}`}
        variant="secondary"
        size="big"
        loading={busy === storeYesterday()}
        disabled={!!busy}
        onPress={() => pick(storeYesterday())}
      />
      <Text style={styles.hint}>Более ранние дни вносит руководитель.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  q: { fontSize: font.title, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: font.small, textAlign: 'center' },
});
