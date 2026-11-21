/**
 * Черновик отправленной смены на следующий день. После «Проверить и отправить» черновик остаётся на телефоне,
 * чтобы в тот же день можно было дописать работы. Назавтра менять ту смену мастеру уже нельзя, поэтому:
 * всё, чего нет на сервере (новые работы, добавленное время), переносится в новую смену на сегодня;
 * если нового нет — черновик просто убирается. Чистая логика без телефона — проверяется тестом.
 */
import type { Draft, DraftEntry, DraftRequest } from './draft';

export type ServerEntry = {
  request_number: string | null;
  department_id: number;
  price_item_id: number | null;
  is_custom: boolean;
  name: string;
  quantity: number | string;
};
export type ServerTime = { request_number: string | null; minutes: number };

const num = (q: string | number) => Number(String(q).replace(',', '.'));

function same(e: DraftEntry, s: ServerEntry): boolean {
  if (e.requestNumber !== s.request_number || e.departmentId !== s.department_id) return false;
  if (num(e.quantity) !== num(s.quantity)) return false;
  if (e.priceItemId) return e.priceItemId === s.price_item_id;
  return s.is_custom && (e.customName ?? e.name).trim().toLowerCase() === s.name.trim().toLowerCase();
}

/** Что в черновике сверх отправленного: работы без пары на сервере и прибавка времени по заявкам. */
export function unsentPart(
  draft: Draft,
  server: ServerEntry[],
  times: ServerTime[],
): { entries: DraftEntry[]; requests: DraftRequest[] } {
  const pool = [...server];
  const entries = draft.entries.filter((e) => {
    const i = pool.findIndex((s) => same(e, s));
    if (i < 0) return true;
    pool.splice(i, 1);
    return false;
  });
  const sent = new Map<string | null, number>();
  for (const t of times) sent.set(t.request_number, (sent.get(t.request_number) ?? 0) + t.minutes);
  // заявки в порядке черновика: из списка времени, затем те, где есть работы
  const order: DraftRequest[] = [...(draft.requests ?? [])];
  for (const e of draft.entries) if (!order.some((r) => r.number === e.requestNumber)) order.push({ number: e.requestNumber, minutes: null, status: 'done' });
  const requests = order
    .map((r) => {
      const extra = (r.minutes ?? 0) - (sent.get(r.number) ?? 0);
      return { number: r.number, minutes: extra > 0 ? extra : null, status: r.status } as DraftRequest;
    })
    .filter((r) => (r.minutes ?? 0) > 0 || entries.some((e) => e.requestNumber === r.number));
  return { entries, requests };
}
