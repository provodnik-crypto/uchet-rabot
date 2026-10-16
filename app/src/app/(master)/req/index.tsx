import { router } from 'expo-router';
import { useEffect } from 'react';
import { BigButton } from '../../../components/BigButton';
import { RequestList } from '../../../components/RequestList';
import { Screen } from '../../../components/Screen';
import { useAuth } from '../../../lib/auth';
import { markRequestsSeen } from '../../../lib/requests';

/** Заявки магазина для просмотра — без выбора даты и без начала смены. */
export default function MasterRequestsScreen() {
  const { me } = useAuth();
  // Открыли список — «Новые» на главной обнуляются.
  useEffect(() => {
    if (me) markRequestsSeen(me.id);
  }, [me]);
  return (
    <Screen>
      <BigButton title="+ Новая заявка" variant="secondary" onPress={() => router.push('/req/new')} />
      <RequestList mode="view" tourId="req.first" onOpen={(r) => router.push({ pathname: '/req/[id]', params: { id: String(r.id) } })} />
    </Screen>
  );
}
