import { StyleSheet, View } from 'react-native';
import type { LifecycleStatus, Priority } from '../lib/requests';
import { font, radius, space, statusColors, type StatusTone } from '../theme';
import { Text } from './Text';

/** Метка статуса: всегда цвет + слово (цвета — statusColors в теме). */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  const c = statusColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Статус заявки для показа. Вернули на доработку — «Вернули» (красная), взята другим мастером —
 * «В работе · Имя Ф.» (чёрная), подрядчик — фиолетовая.
 */
export function requestTone(r: {
  status: LifecycleStatus;
  returned?: boolean | null;
  contractor?: boolean | null;
  /** Имя мастера, если заявка в работе у другого. */
  busyName?: string | null;
}): { tone: StatusTone; label: string } {
  if (r.status === 'contractor' || (r.contractor && r.status === 'waiting')) return { tone: 'contractor', label: 'Подрядчик' };
  if ((r.status === 'in_work' || r.status === 'paused') && r.returned) return { tone: 'returned', label: 'Вернули' };
  if (r.status === 'in_work' && r.busyName) return { tone: 'busy', label: `В работе · ${r.busyName}` };
  switch (r.status) {
    case 'in_work':
      return { tone: 'in_work', label: 'В работе' };
    case 'paused':
      return { tone: 'paused', label: 'Приостановлена' };
    case 'review':
      return { tone: 'review', label: 'На проверке' };
    case 'accepted':
      return { tone: 'accepted', label: 'Принята' };
    default:
      return { tone: 'waiting', label: 'Ожидает' };
  }
}

/** Метка приоритета: срочная и высокий (обычный и низкий не показываем). */
export function PriorityPill({ priority }: { priority: Priority }) {
  if (priority === 1) return <StatusPill tone="urgent" label="! Срочно" />;
  if (priority === 2) return <StatusPill tone="high" label="Высокий" />;
  return null;
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: space.s10, paddingVertical: space.s4, alignSelf: 'flex-start' },
  text: { fontSize: font.caption, fontWeight: '700' },
});
