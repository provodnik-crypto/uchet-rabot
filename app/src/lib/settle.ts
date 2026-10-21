import { Alert, Platform } from 'react-native';
import { requestCard, settleRequestWorks, type LifecycleStatus, type RequestWork } from './requests';

/**
 * Перед передачей заявки подрядчику или закрытием: если в ней есть работы «ждут приёмки», руководитель решает —
 * засчитать их мастеру или нет (иначе они повисли бы навсегда: принять такую заявку уже нельзя).
 * false — руководитель передумал (действие не выполнять).
 */
export async function settleBeforeLeaving(
  requestId: number,
  action: string,
  card?: { works: RequestWork[]; status: LifecycleStatus } | null,
): Promise<boolean> {
  const c = card ?? (await requestCard({ id: requestId }));
  // на проверке заявку ещё можно принять — работы решатся приёмкой
  if (!c || c.status === 'review' || c.status === 'accepted') return true;
  const n = c.works.filter((w) => w.status === 'awaiting').length;
  if (!n) return true;
  const title = `${action}: работ мастера ждут приёмки — ${n}`;
  const message = 'Заявку уже не примут. Засчитать эти работы мастеру (войдут в суммы) или не засчитывать?';
  const choice = await new Promise<boolean | null>((resolve) => {
    if (Platform.OS === 'web') {
      resolve(window.confirm(`${title}\n\n${message}\n\nОК — засчитать, Отмена — не засчитывать`));
      return;
    }
    Alert.alert(title, message, [
      { text: 'Отмена', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Не засчитывать', style: 'destructive', onPress: () => resolve(false) },
      { text: 'Засчитать', onPress: () => resolve(true) },
    ]);
  });
  if (choice === null) return false;
  await settleRequestWorks(requestId, choice);
  return true;
}
