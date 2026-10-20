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
      <Stack.Screen name="reports" options={{ title: 'Сообщения от мастеров' }} />
      <Stack.Screen name="help" options={{ title: 'Помощь' }} />
      <Stack.Screen name="export" options={{ title: 'Выгрузка в Excel' }} />
      <Stack.Screen name="requests/index" options={{ title: 'Заявки' }} />
      <Stack.Screen name="requests/[id]" options={{ title: 'Заявка' }} />
      <Stack.Screen name="requests/new" options={{ title: 'Новая заявка' }} />
      <Stack.Screen name="requests/close-old" options={{ title: 'Закрыть старые заявки' }} />
      <Stack.Screen name="import" options={{ title: 'Загрузка заявок' }} />
      <Stack.Screen name="review/index" options={{ title: 'На проверке' }} />
      <Stack.Screen name="review/[id]" options={{ title: 'Проверка заявки' }} />
    </Stack>
  );
}

/** Ошибка на любом экране раздела — сообщение вместо закрытия приложения. */
export { ScreenError as ErrorBoundary } from '../../components/ScreenError';
