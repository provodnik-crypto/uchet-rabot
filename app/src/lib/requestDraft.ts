import { requestList, type Draft, type DraftEntry } from './draft';
import type { RequestCard } from './requests';

/**
 * Заявка вместе с черновиком смены на телефоне. Черновик — главная версия своего дня: если смена уже
 * отправлялась (правка дня), её работы и время с сервера заменяются черновиком, а не теряются и не удваиваются.
 */
export function withDraft(r: RequestCard, draft: Draft | null) {
  const mine = (x: { shift_uuid?: string }) => !!draft && x.shift_uuid === draft.clientUuid;
  const works = r.works.filter((w) => !mine(w));
  const timeByDay = r.time_by_day.filter((t) => !mine(t));
  const draftEntries: DraftEntry[] = draft?.entries.filter((e) => e.requestNumber === r.number) ?? [];
  const draftTime = draft ? requestList(draft).find((t) => t.number === r.number) : undefined;
  const todayMinutes = draftTime?.minutes ?? 0;
  const spent = r.spent_minutes - r.time_by_day.filter(mine).reduce((a, t) => a + t.minutes, 0) + todayMinutes;
  return { works, timeByDay, draftEntries, draftTime, todayMinutes, spent };
}
