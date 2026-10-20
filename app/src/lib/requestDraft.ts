import type { Draft, DraftEntry } from './draft';
import type { RequestCard } from './requests';

/**
 * Заявка вместе с черновиком смены на телефоне. Черновик — главная версия своего дня: если смена уже
 * отправлялась (правка дня), её работы с сервера заменяются черновиком, а не теряются и не удваиваются.
 */
export function withDraft(r: RequestCard, draft: Draft | null) {
  const mine = (x: { shift_uuid?: string }) => !!draft && x.shift_uuid === draft.clientUuid;
  const works = r.works.filter((w) => !mine(w));
  const draftEntries: DraftEntry[] = draft?.entries.filter((e) => e.requestNumber === r.number) ?? [];
  return { works, draftEntries };
}
