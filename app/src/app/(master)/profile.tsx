import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { BigButton } from '../../components/BigButton';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { Tile } from '../../components/Tile';
import { appVersionLabel } from '../../lib/appUpdate';
import { useAuth } from '../../lib/auth';
import { useEmployeeIcons } from '../../lib/employeeIcons';
import { TourTarget } from '../../lib/tour';
import { colors, font, space, touch } from '../../theme';

/** Профиль мастера: помощь, «Мои сообщения руководителю», выход, версия. */
export default function MasterProfile() {
  const { me, signOut } = useAuth();
  const icons = useEmployeeIcons();
  return (
    <Screen>
      <Section>
        <View style={styles.row}>
          {me ? <Avatar name={me.displayName} icon={icons[me.id]} size={touch.big} dark /> : null}
          <View style={styles.flex}>
            <Text style={styles.name}>{me?.displayName}</Text>
            <Text style={styles.meta}>Мастер · {me?.login}</Text>
          </View>
        </View>
      </Section>
      <TourTarget id="profile.help">
        <Tile title="Помощь" subtitle="Обучение по шагам и «Что нового»" onPress={() => router.push('/help')} />
      </TourTarget>
      <Tile title="Мои сообщения руководителю" subtitle="Ответы на «Сообщить о поломке»" onPress={() => router.push('/req/report')} />
      <BigButton title="Выйти" variant="secondary" onPress={signOut} />
      <Text style={styles.version}>{appVersionLabel()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s12 },
  flex: { flex: 1, gap: space.s2 },
  name: { fontSize: font.header, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
  version: { fontSize: font.caption, color: colors.muted, textAlign: 'center' },
});
