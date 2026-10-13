// Отправка черновика смены на сервер — общая для «Закрыть смену» и «Проверить и отправить» по заявке.
import { groupIsSent, shiftGroups, type Draft, type DraftEntry } from './draft';
import { parseQuantity, submitShift, type SubmitEntry, type SubmitRequest } from './shift';
import { toPayload, uploadPhotos, type DraftPhoto } from './workPhotos';

/**
 * Загружает недостающие фото (каждое загруженное сразу сохраняется в черновик — «Повторить» догрузит остальные)
 * и сохраняет смену. Повторная отправка того же черновика в тот же день заменяет смену целиком.
 */
export async function sendDraft(
  draft: Draft,
  upsertEntry: (e: DraftEntry) => void,
  onProgress: (text: string | null) => void,
): Promise<{ shift_id: number; entries: number; pending: number }> {
  const groups = shiftGroups(draft).filter(groupIsSent);
  const uploaded = new Map<string, DraftPhoto>();
  const all = draft.entries.flatMap((e) => (e.photos ?? []).map((p) => ({ entry: e, photo: p })));
  if (all.some(({ photo }) => !photo.path)) {
    await uploadPhotos(
      all.map((x) => x.photo),
      (p) => {
        uploaded.set(p.key, p);
        const owner = all.find((x) => x.photo.key === p.key)!.entry;
        upsertEntry({ ...owner, photos: (owner.photos ?? []).map((x) => uploaded.get(x.key) ?? x) });
      },
      (done, total) => onProgress(`Загружаем фото: ${done} из ${total}`),
    );
  }
  onProgress('Отправляем…');
  const withPhotos = (e: DraftEntry) => (e.photos ?? []).map((p) => uploaded.get(p.key) ?? p);
  // Порядок работ — как на экране: по заявкам.
  const entries: SubmitEntry[] = groups.flatMap((g) =>
    g.entries.map((e) => ({
      request_number: e.requestNumber,
      department_id: e.departmentId,
      ...(e.priceItemId ? { price_item_id: e.priceItemId } : { custom_name: e.customName ?? e.name, unit_id: e.unitId }),
      quantity: parseQuantity(e.quantity, e.integerOnly).value ?? Number(e.quantity.replace(',', '.')),
      note: e.note || null,
      performer_ids: e.performerIds,
      photos: toPayload(withPhotos(e)),
    })),
  );
  const requests: SubmitRequest[] = groups.map((g) => ({ request_number: g.request, minutes: g.time.minutes ?? 0 }));
  try {
    return await submitShift({ client_uuid: draft.clientUuid, work_date: draft.workDate, entries, requests });
  } finally {
    onProgress(null);
  }
}

/** В черновике есть, что отправить: работы или время. */
export const draftHasContent = (d: Draft | null) => !!d && shiftGroups(d).some(groupIsSent);
