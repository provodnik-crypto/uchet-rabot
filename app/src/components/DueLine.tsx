import { StyleSheet } from 'react-native';
import { Text } from './Text';
import { dueState } from '../lib/requests';
import { colors, font } from '../theme';

/**
 * Срок выполнения из ITSM («Время разрешения»). Просроченная — красным.
 * Не показывается у принятых и закрытых заявок и у заявок без срока.
 */
export function DueLine({ dueAt, status, isOpen = true }: { dueAt: string | null | undefined; status?: string; isOpen?: boolean }) {
  const d = dueState(dueAt);
  if (!d || !isOpen || status === 'accepted') return null;
  return <Text style={[styles.due, d.overdue && styles.overdue]}>{d.overdue ? `Просрочена · срок ITSM был до ${d.text}` : `Срок ITSM: до ${d.text}`}</Text>;
}

const styles = StyleSheet.create({
  due: { fontSize: font.small, color: colors.secondary },
  overdue: { color: colors.danger, fontWeight: '700' },
});
