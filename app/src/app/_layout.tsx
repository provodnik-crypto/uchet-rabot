import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BigButton } from '../components/BigButton';
import { UpdateBanner } from '../components/UpdateBanner';
import { AuthProvider, useAuth } from '../lib/auth';
import { TourProvider } from '../lib/tour';
import { isConfigured } from '../lib/supabase';
import { colors, font } from '../theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <TourProvider>
          <UpdateBanner />
          <RootStack />
        </TourProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootStack() {
  const { loading, session, me, accessError, loadError, retry, signOut } = useAuth();

  if (!isConfigured) {
    return (
      <Centered>
        <Text style={styles.title}>Приложение не настроено</Text>
        <Text style={styles.text}>Не указан адрес сервера (EXPO_PUBLIC_SUPABASE_URL). Это нужно исправить при сборке.</Text>
      </Centered>
    );
  }
  if (loading) {
    return (
      <Centered>
        <ActivityIndicator size="large" color={colors.black} />
      </Centered>
    );
  }
  if (session && !me && !accessError) {
    return (
      <Centered>
        <Text style={styles.title}>Нет связи</Text>
        <Text style={styles.text}>{loadError ?? 'Не удалось загрузить данные пользователя.'}</Text>
        <BigButton title="Повторить" onPress={retry} />
        <BigButton title="Выйти" variant="secondary" onPress={signOut} />
      </Centered>
    );
  }

  const header = {
    headerStyle: { backgroundColor: colors.brand },
    headerTintColor: colors.black,
    headerTitleStyle: { fontWeight: '700' as const },
    contentStyle: { backgroundColor: colors.bg },
  };

  return (
    <Stack screenOptions={{ ...header, headerShown: false }}>
      <Stack.Protected guard={!session || !!accessError}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={!accessError && me?.role === 'master'}>
        <Stack.Screen name="(master)" />
      </Stack.Protected>
      <Stack.Protected guard={!accessError && me?.role === 'manager'}>
        <Stack.Screen name="(manager)" />
      </Stack.Protected>
    </Stack>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'stretch', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: font.title, fontWeight: '700', textAlign: 'center' },
  text: { fontSize: font.body, textAlign: 'center', color: colors.muted },
});
