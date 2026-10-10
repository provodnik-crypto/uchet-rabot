import { Alert, Platform, StyleSheet, Text } from 'react-native';
import { BigButton } from '../../components/BigButton';
import { Screen } from '../../components/Screen';
import { Tile } from '../../components/Tile';
import { useAuth } from '../../lib/auth';
import { colors, font } from '../../theme';

function soon() {
  const text = 'Внесение работ появится на этапе 3.';
  if (Platform.OS === 'web') window.alert(text);
  else Alert.alert('Скоро', text);
}

export default function MasterHome() {
  const { me, signOut } = useAuth();
  return (
    <Screen>
      <Text style={styles.hello}>Здравствуйте, {me?.displayName}!</Text>
      <BigButton title="Закрыть смену" size="big" onPress={soon} />
      <Tile title="Моя история" subtitle="Внесённые работы и их статусы" soon />
      <BigButton title="Выйти" variant="secondary" onPress={signOut} />
      <Text style={styles.role}>Вы вошли как мастер · {me?.login}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: { fontSize: font.header, fontWeight: '800' },
  role: { textAlign: 'center', color: colors.muted, fontSize: font.small },
});
