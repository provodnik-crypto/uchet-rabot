/** Магазин в Тюмени (UTC+5, без перехода на летнее время): «сегодня» считаем по его часам, как и сервер. */
const STORE_OFFSET_MS = 5 * 60 * 60 * 1000;

export function storeToday(): string {
  return new Date(Date.now() + STORE_OFFSET_MS).toISOString().slice(0, 10);
}

export function storeYesterday(): string {
  return new Date(Date.now() + STORE_OFFSET_MS - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Случайный идентификатор черновика: по нему сервер отличает повторную отправку от новой смены. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** «N-й день» заявки: с даты взятия по календарю магазина (Тюмень, UTC+5) — взятая ночью не «вчера». */
export function takenDayNumber(takenAt: string | null | undefined): number | null {
  if (!takenAt) return null;
  const t = Date.parse(takenAt);
  if (!Number.isFinite(t)) return null;
  const local = new Date(t + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const n = Math.round((Date.parse(storeToday()) - Date.parse(local)) / 86_400_000) + 1;
  return Number.isFinite(n) ? Math.max(1, n) : null;
}
