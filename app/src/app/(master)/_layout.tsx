import { Stack } from 'expo-router';
import { stackHeader } from '../../components/Header';

export default function MasterLayout() {
  return (
    <Stack screenOptions={stackHeader}>
      <Stack.Screen name="index" options={{ title: 'Учёт работ' }} />
    </Stack>
  );
}
