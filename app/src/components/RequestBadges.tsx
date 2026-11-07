import { StyleSheet, View } from 'react-native';
import type { LifecycleStatus, Priority } from '../lib/requests';
import { space } from '../theme';
import { PriorityPill, requestTone, StatusPill } from './StatusPill';

/** Метки заявки: «Назначено вам», статус (цвет + слово), приоритет, новые сообщения. */
export function RequestBadges({
  status,
  priority,
  contractor,
  mine,
  responsibleName,
  unread,
  returned,
}: {
  status: LifecycleStatus;
  priority: Priority;
  contractor?: boolean;
  mine?: boolean;
  /** Для «В работе · Имя Ф.» у чужой заявки. */
  responsibleName?: string | null;
  /** Новые сообщения и события. */
  unread?: number;
  /** Вернули на доработку. */
  returned?: boolean;
}) {
  const s = requestTone({ status, contractor, returned, busyName: responsibleName });
  return (
    <View style={styles.row}>
      {mine && status === 'waiting' && !contractor ? <StatusPill tone="in_work" label="Назначено вам" /> : <StatusPill tone={s.tone} label={s.label} />}
      <PriorityPill priority={priority} />
      {unread ? <StatusPill tone="busy" label={`Новое: ${unread}`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s6 },
});
