import { Alert, Platform } from 'react-native';
import { confirm } from './confirm';
import { employeeOpenRequests, releaseEmployeeRequests, requestCard, requestLabel, settleRequestWorks, type LifecycleStatus, type RequestWork } from './requests';

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

/** Перед отключением мастера: показать его открытые заявки и решить про работы «ждут приёмки». false — отмена. */
export async function releaseBeforeDeactivate(employeeId: number, name: string): Promise<boolean> {
  const info = await employeeOpenRequests(employeeId);
  const awaiting = info.requests.reduce((n, r) => n + r.awaiting, 0);
  const lines = [
    info.requests.length ? `В работе у него заявок: ${info.requests.length} (${info.requests.map((r) => requestLabel(r.number)).join(', ')}) — станут свободными.` : null,
    info.assigned ? `Назначенных ему заявок: ${info.assigned} — назначение снимется.` : null,
    'Войти он больше не сможет, история сохранится.',
  ].filter(Boolean);
  if (!(await confirm(`Отключить ${name}?`, lines.join('\n'), 'Отключить'))) return false;
  let credit: boolean | null = null;
  if (awaiting) {
    credit = await new Promise<boolean | null>((resolve) => {
      const title = `Его работ ждут приёмки: ${awaiting}`;
      const message = 'Заявки уйдут от него. Засчитать эти работы ему (войдут в суммы) или не засчитывать?';
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
    if (credit === null) return false;
  }
  if (info.requests.length || info.assigned) await releaseEmployeeRequests(employeeId, credit);
  return true;
}
