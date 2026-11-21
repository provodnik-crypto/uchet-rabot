import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppHeader, IconButton } from '../../components/AppHeader';
import { BigButton } from '../../components/BigButton';
import { LoadStatus } from '../../components/LoadStatus';
import { Screen, useScreenRefresh } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { PriorityPill, requestTone, StatusPill } from '../../components/StatusPill';
import { Text } from '../../components/Text';
import { TourTarget, useTour } from '../../lib/tour';
import { initiatorRequests, type InitiatorRequest } from '../../lib/initiators';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font, radius, space, stroke, touch } from '../../theme';

type Scope = 'my' | 'department';

/** «21.11 14:05» — время подачи, как на бумажном шаблоне. */
function when(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

function Row({ r }: { r: InitiatorRequest }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Заявка: ${r.subject}`}
      onPress={() => router.push(`/req/${r.id}`)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.subject} numberOfLines={2}>
          {r.subject}
        </Text>
        <View style={styles.pills}>
          {r.priority === 1 ? <PriorityPill priority={1} /> : null}
          <StatusPill {...requestTone({ status: r.status })} />
        </View>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {when(r.created_at)} · {r.creator_name}
        {r.master_name ? ` · мастер: ${r.master_name}` : ''}
      </Text>
    </Pressable>
  );
}

/** Вкладка «Заявки»: переключатель «Мои» / «Отдел», самая старая сверху. */
export default function InitiatorRequestsScreen() {
  const [scope, setScope] = useState<Scope>('my');
  const q = useFocusQuery(() => initiatorRequests(scope), { key: `init:list:${scope}` });
  useScreenRefresh(q.reload);
  const list = q.data ?? [];
  const { autoStart } = useTour();
  useFocusEffect(useCallback(() => void autoStart('initiator', false), [autoStart]));

  return (
    <Screen
      status={q}
      footer={
        <TourTarget id="ihome.new">
          <BigButton title="+ Новая заявка" onPress={() => router.push('/req/new')} />
        </TourTarget>
      }
      header={
        <AppHeader
          title="Заявки"
          large
          right={<IconButton icon="person" label="Профиль" onPress={() => router.push('/profile')} />}
        >
          <TourTarget id="ihome.scope">
            <Segmented<Scope>
              options={[
                { value: 'my', label: 'Мои' },
                { value: 'department', label: 'Отдел' },
              ]}
              value={scope}
              onChange={setScope}
            />
          </TourTarget>
        </AppHeader>
      }
    >
      <LoadStatus status={q} />
      {list.length === 0 && !q.loading && !q.error ? (
        <Text style={styles.empty}>
          {scope === 'my'
            ? 'Пока нет ваших заявок. Нажмите «+ Новая заявка».'
            : 'В вашем отделе пока нет заявок.'}
        </Text>
      ) : null}
      <View style={styles.list}>
        {list.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.s8 },
  row: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: stroke.hair,
    borderColor: colors.border,
    padding: space.s12,
    gap: space.s6,
    minHeight: touch.small,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s8 },
  subject: { flex: 1, fontSize: font.body, fontWeight: '600' },
  pills: { flexDirection: 'row', alignItems: 'center', gap: space.s6 },
  meta: { fontSize: font.small, color: colors.muted },
  empty: { fontSize: font.body, color: colors.muted, textAlign: 'center', paddingVertical: space.s24 },
});
