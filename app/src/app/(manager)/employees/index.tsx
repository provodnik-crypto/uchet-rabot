import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { listEmployees, roleLabel } from '../../../lib/employees';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

export default function EmployeesScreen() {
  const { data, error, loading, reload } = useFocusQuery(listEmployees);
  return (
    <Screen>
      <BigButton title="+ Добавить сотрудника" onPress={() => router.push('/employees/new')} />
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data?.map((e) => (
        <Card key={e.id} onPress={() => router.push({ pathname: '/employees/[id]', params: { id: String(e.id) } })}>
          <View style={styles.row}>
            <Text style={[styles.name, !e.is_active && styles.off]}>{e.display_name}</Text>
            <Text style={styles.role}>{roleLabel[e.role]}</Text>
          </View>
          <Text style={styles.sub}>
            {!e.is_active
              ? 'Отключён'
              : e.role === 'service'
                ? 'Для работ без исполнителя, входа нет'
                : e.has_account
                  ? `Логин: ${e.login}`
                  : 'Нет учётной записи'}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: font.body, fontWeight: '700' },
  off: { color: colors.muted, textDecorationLine: 'line-through' },
  role: { fontSize: font.small, color: colors.muted },
  sub: { fontSize: font.small, color: colors.muted, marginTop: 4 },
});
