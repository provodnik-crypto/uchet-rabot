import { Stack } from 'expo-router';
import { stackHeader } from '../../components/Header';
import { DraftProvider } from '../../lib/draft';

export default function MasterLayout() {
  return (
    <DraftProvider>
      <Stack screenOptions={stackHeader}>
        <Stack.Screen name="index" options={{ title: 'Учёт работ' }} />
        <Stack.Screen name="shift/date" options={{ title: 'Дата смены' }} />
        <Stack.Screen name="shift/request" options={{ title: 'Заявка' }} />
        <Stack.Screen name="shift/work" options={{ title: 'Выбор работы' }} />
        <Stack.Screen name="shift/entry" options={{ title: 'Работа' }} />
        <Stack.Screen name="shift/list" options={{ title: 'Работы смены' }} />
        <Stack.Screen name="shift/review" options={{ title: 'Проверка' }} />
        <Stack.Screen name="shift/done" options={{ title: 'Готово', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="history" options={{ title: 'Моя история' }} />
        <Stack.Screen name="fix" options={{ title: 'Исправить работу' }} />
        <Stack.Screen name="team" options={{ title: 'Команда' }} />
        <Stack.Screen name="help" options={{ title: 'Помощь' }} />
      </Stack>
    </DraftProvider>
  );
}
