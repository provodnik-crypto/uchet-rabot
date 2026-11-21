import { Stack } from 'expo-router';
import { stackHeader } from '../../components/Header';

export default function InitiatorLayout() {
  return (
    <Stack screenOptions={stackHeader}>
      {/* Список и карточка — со своей жёлтой шапкой (AppHeader) */}
      <Stack.Screen name="index" options={{ title: 'Заявки', headerShown: false, animation: 'none' }} />
      <Stack.Screen name="req/new" options={{ title: 'Новая заявка', headerShown: false }} />
      <Stack.Screen name="req/[id]" options={{ title: 'Заявка', headerShown: false }} />
      <Stack.Screen name="profile" options={{ title: 'Профиль' }} />
    </Stack>
  );
}

/** Ошибка на любом экране раздела — сообщение вместо закрытия приложения. */
export { ScreenError as ErrorBoundary } from '../../components/ScreenError';
