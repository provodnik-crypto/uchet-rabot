import { router } from 'expo-router';
import { useEffect } from 'react';
import { BigButton } from '../../../components/BigButton';
import { RequestList } from '../../../components/RequestList';
import { Screen } from '../../../components/Screen';
import { useAuth } from '../../../lib/auth';
import { markRequestsSeen } from '../../../lib/requests';
import { TourTarget } from '../../../lib/tour';
import { StyleSheet, View } from 'react-native';

/** Заявки магазина. Сверху — «Работа без заявки» (плановая) и «Сообщить руководителю» (заявки создаёт только он). */
export default function MasterRequestsScreen() {
  const { me } = useAuth();
  // Открыли список — «Новые» на главной обнуляются.
  useEffect(() => {
    if (me) markRequestsSeen(me.id);
  }, [me]);
  return (
    <Screen>
      <View style={styles.actions}>
        <View style={styles.flex}>
          <TourTarget id="req.planned">
            <BigButton title="Работа без заявки" variant="secondary" size="small" onPress={() => router.push('/req/new')} />
          </TourTarget>
        </View>
        <View style={styles.flex}>
          <TourTarget id="req.report">
            <BigButton title="Сообщить руководителю" variant="secondary" size="small" onPress={() => router.push('/req/report')} />
          </TourTarget>
        </View>
      </View>
      <RequestList tourId="req.first" onOpen={(r) => router.push({ pathname: '/req/[id]', params: { id: String(r.id) } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
