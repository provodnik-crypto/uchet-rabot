import { router } from 'expo-router';
import { ManualRequestForm } from '../../../components/ManualRequestForm';
import { Screen } from '../../../components/Screen';

/** Руководитель создаёт заявку без номера ITSM: «Ожидает», можно сразу назначить мастеру. */
export default function NewRequestScreen() {
  return (
    <Screen>
      <ManualRequestForm
        manager
        onCreated={(r) => router.replace({ pathname: '/requests/[id]', params: { id: String(r.id), number: r.number } })}
      />
    </Screen>
  );
}
