import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useTour } from '../lib/tour';
import { TOURS, WHATS_NEW, type TourId } from '../lib/tours';
import { colors, font, space } from '../theme';
import { Card } from './Card';
import { Screen } from './Screen';

/** «Помощь»: обучение по шагам в любой момент и история «Что нового». */
export function HelpScreen({ role }: { role: 'master' | 'manager' }) {
  const { start, showWhatsNew } = useTour();
  const tours = Object.values(TOURS).filter((t) => t.role === role);
  const run = (id: TourId) => {
    router.back(); // обучение начинается с главного экрана
    setTimeout(() => start(id), 350);
  };
  return (
    <Screen>
      <Text style={styles.section}>Обучение по шагам</Text>
      <Text style={styles.meta}>Подсказки появятся прямо на экранах приложения. В любой момент можно нажать «Пропустить».</Text>
      {tours.map((t) => (
        <Card key={t.id} style={styles.card} onPress={() => run(t.id)}>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.meta}>{t.about}</Text>
        </Card>
      ))}
      <Text style={styles.section}>Что нового</Text>
      {WHATS_NEW.map((w) => (
        <Card key={w.id} style={styles.card} onPress={() => showWhatsNew(w)}>
          <Text style={styles.title}>Обновление от {w.date}</Text>
          <View style={styles.list}>
            {(role === 'manager' ? w.manager : w.master).map((t) => (
              <Text key={t} style={styles.meta}>
                • {t}
              </Text>
            ))}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: font.text, fontWeight: '700', marginTop: space.s4 },
  card: { gap: space.s4 },
  title: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.muted },
  list: { gap: space.s2 },
});
