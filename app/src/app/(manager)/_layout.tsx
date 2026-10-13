import { Stack } from 'expo-router';
import { stackHeader } from '../../components/Header';

export default function ManagerLayout() {
  return (
    <Stack screenOptions={stackHeader}>
      <Stack.Screen name="index" options={{ title: 'Руководитель' }} />
      <Stack.Screen name="employees/index" options={{ title: 'Сотрудники' }} />
      <Stack.Screen name="employees/new" options={{ title: 'Новый сотрудник' }} />
      <Stack.Screen name="employees/[id]" options={{ title: 'Сотрудник' }} />
      <Stack.Screen name="departments/index" options={{ title: 'Отделы' }} />
      <Stack.Screen name="departments/[id]" options={{ title: 'Отдел' }} />
      <Stack.Screen name="price/index" options={{ title: 'Прайс' }} />
      <Stack.Screen name="price/[id]" options={{ title: 'Позиция прайса' }} />
      <Stack.Screen name="pending/index" options={{ title: 'На оценке' }} />
      <Stack.Screen name="pending/[id]" options={{ title: 'Оценка работы' }} />
      <Stack.Screen name="entries/index" options={{ title: 'Работы' }} />
      <Stack.Screen name="entries/[id]" options={{ title: 'Правка работы' }} />
      <Stack.Screen name="summary" options={{ title: 'Сводка' }} />
      <Stack.Screen name="export" options={{ title: 'Выгрузка в Excel' }} />
      <Stack.Screen name="requests/index" options={{ title: 'Заявки' }} />
      <Stack.Screen name="requests/[id]" options={{ title: 'Заявка' }} />
      <Stack.Screen name="import" options={{ title: 'Загрузка заявок' }} />
    </Stack>
  );
}
