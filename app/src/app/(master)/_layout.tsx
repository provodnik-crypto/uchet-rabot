import { Stack } from 'expo-router';
import { stackHeader } from '../../components/Header';
import { DraftProvider } from '../../lib/draft';

export default function MasterLayout() {
  return (
    <DraftProvider>
      <Stack screenOptions={stackHeader}>
        <Stack.Screen name="index" options={{ title: 'Учёт работ' }} />
        <Stack.Screen name="req/index" options={{ title: 'Заявки' }} />
        <Stack.Screen name="req/[id]" options={{ title: 'Заявка' }} />
        <Stack.Screen name="req/new" options={{ title: 'Работа без заявки' }} />
        <Stack.Screen name="req/report" options={{ title: 'Сообщить руководителю' }} />
        <Stack.Screen name="req/send/[id]" options={{ title: 'Отправить на проверку' }} />
        <Stack.Screen name="shift/work" options={{ title: 'Выбор работы' }} />
        <Stack.Screen name="shift/entry" options={{ title: 'Работа' }} />
        <Stack.Screen name="history" options={{ title: 'Моя история' }} />
        <Stack.Screen name="fix" options={{ title: 'Исправить работу' }} />
        <Stack.Screen name="team" options={{ title: 'Команда' }} />
        <Stack.Screen name="help" options={{ title: 'Помощь' }} />
      </Stack>
    </DraftProvider>
  );
}

/** Ошибка на любом экране раздела — сообщение вместо закрытия приложения. */
export { ScreenError as ErrorBoundary } from '../../components/ScreenError';
