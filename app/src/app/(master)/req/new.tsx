import { router, useLocalSearchParams } from 'expo-router';
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
          if (select) {
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
