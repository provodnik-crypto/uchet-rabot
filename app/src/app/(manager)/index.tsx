import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { BigButton } from '../../components/BigButton';
import { Screen } from '../../components/Screen';
import { Tile } from '../../components/Tile';
import { useAuth } from '../../lib/auth';
import { colors, font } from '../../theme';

export default function ManagerHome() {
  const { me, signOut } = useAuth();
  return (
    <Screen>
      <Text style={styles.hello}>{me?.displayName}</Text>
      <Tile title="На оценке" subtitle="Работы вне прайса без цены" soon />
      <Tile title="Работы" subtitle="Журнал с фильтрами" soon />
      <Tile title="Сводка" subtitle="Выработка по сотрудникам и месяцам" soon />
      <Tile title="Выгрузить в Excel" soon />
      <Text style={styles.section}>Справочники</Text>
      <Tile title="Сотрудники" subtitle="Учётные записи и пароли" onPress={() => router.push('/employees')} />
      <Tile title="Отделы, заявки, прайс" soon />
      <BigButton title="Выйти" variant="secondary" onPress={signOut} />
      <Text style={styles.role}>Вы вошли как руководитель · {me?.login}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: { fontSize: font.header, fontWeight: '800' },
  section: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 8 },
  role: { textAlign: 'center', color: colors.muted, fontSize: font.small },
});
