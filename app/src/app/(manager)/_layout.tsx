import { Stack } from 'expo-router';
import { stackHeader } from '../../components/Header';

export default function ManagerLayout() {
  return (
    <Stack screenOptions={stackHeader}>
      <Stack.Screen name="index" options={{ title: 'Руководитель' }} />
      <Stack.Screen name="employees/index" options={{ title: 'Сотрудники' }} />
      <Stack.Screen name="employees/new" options={{ title: 'Новый сотрудник' }} />
      <Stack.Screen name="employees/[id]" options={{ title: 'Сотрудник' }} />
    </Stack>
  );
}
