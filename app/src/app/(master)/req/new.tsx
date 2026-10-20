import { router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { requestLabel } from '../../../lib/requests';
import { ManualRequestForm } from '../../../components/ManualRequestForm';
import { Screen } from '../../../components/Screen';
import { useDraft } from '../../../lib/draft';

/** Мастер создаёт заявку без номера ITSM. Из закрытия смены (select) — сразу к выбору работы. */
export default function NewRequestScreen() {
  const { select } = useLocalSearchParams<{ select?: string }>();
  const { setRequest } = useDraft();
  return (
    <Screen>
      <ManualRequestForm
        manager={false}
        onCreated={(r) => {
          if (r.queued) {
            // у мастера уже есть заявка в работе — новая ждёт очереди
            Alert.alert(
              `Заявка ${requestLabel(r.number)} создана`,
              'Она назначена вам и ждёт: у вас уже есть заявка в работе. Отправьте текущую на проверку — потом возьмите эту.',
            );
            router.replace({ pathname: '/req/[id]', params: { id: String(r.id) } });
          } else if (select) {
            setRequest(r.number);
            router.replace('/shift/work');
          } else {
            router.replace({ pathname: '/req/[id]', params: { id: String(r.id) } });
          }
        }}
      />
    </Screen>
  );
}
