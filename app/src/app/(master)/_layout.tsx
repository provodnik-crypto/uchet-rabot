import { Stack } from 'expo-router';
import { stackHeader } from '../../components/Header';
import { DraftProvider } from '../../lib/draft';

export default function MasterLayout() {
  return (
    <DraftProvider>
      <Stack screenOptions={stackHeader}>
        {/* Вкладки, карточка и отправка — со своей жёлтой шапкой (AppHeader) */}
        <Stack.Screen name="index" options={{ title: 'Главная', headerShown: false, animation: 'none' }} />
        <Stack.Screen name="req/index" options={{ title: 'Заявки', headerShown: false, animation: 'none' }} />
        <Stack.Screen name="req/[id]" options={{ title: 'Заявка', headerShown: false }} />
        <Stack.Screen name="req/new" options={{ title: 'Работа без заявки' }} />
        <Stack.Screen name="req/report" options={{ title: 'Сообщить о поломке' }} />
        <Stack.Screen name="req/send/[id]" options={{ title: 'Отправить на проверку', headerShown: false }} />
        <Stack.Screen name="shift/work" options={{ title: 'Выбор работы' }} />
        <Stack.Screen name="shift/entry" options={{ title: 'Работа' }} />
        <Stack.Screen name="history" options={{ title: 'История', headerShown: false, animation: 'none' }} />
        <Stack.Screen name="fix" options={{ title: 'Исправить работу' }} />
        <Stack.Screen name="help" options={{ title: 'Помощь' }} />
        <Stack.Screen name="profile" options={{ title: 'Профиль' }} />
      </Stack>
    </DraftProvider>
  );
}

/** Ошибка на любом экране раздела — сообщение вместо закрытия приложения. */
export { ScreenError as ErrorBoundary } from '../../components/ScreenError';
