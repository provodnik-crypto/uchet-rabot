import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { Avatar } from '../../../components/Avatar';
import { listEmployees, roleLabel } from '../../../lib/employees';
import { usePhotoUrls } from '../../../lib/photos';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

export default function EmployeesScreen() {
  const { data, error, loading, reload } = useFocusQuery(listEmployees);
  const photos = usePhotoUrls();
  return (
    <Screen>
      <BigButton title="+ Добавить сотрудника" onPress={() => router.push('/employees/new')} />
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data?.map((e) => (
        <Card key={e.id} onPress={() => router.push({ pathname: '/employees/[id]', params: { id: String(e.id) } })}>
          <View style={styles.person}>
            <Avatar name={e.display_name} photo={photos[e.id]} size={52} />
            <View style={styles.flex}>
              <Text style={[styles.name, !e.is_active && styles.off]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {e.display_name}
              </Text>
              <Text style={styles.role}>{roleLabel[e.role]}</Text>
              <Text style={styles.sub}>
            {!e.is_active
              ? 'Отключён'
              : e.role === 'service'
                ? 'Для работ без исполнителя, входа нет'
                : e.has_account
                  ? `Логин: ${e.login}`
                  : 'Нет учётной записи'}
              </Text>
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  name: { fontSize: font.body, fontWeight: '700' },
  off: { color: colors.muted, textDecorationLine: 'line-through' },
  role: { fontSize: font.small, color: colors.muted },
  sub: { fontSize: font.small, color: colors.muted, marginTop: 4 },
});
