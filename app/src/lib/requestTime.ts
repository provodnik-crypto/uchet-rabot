/** Время по заявкам: длина смены, быстрый выбор, подписи. */
export const SHIFT_MINUTES = 8 * 60; // как public.shift_minutes() в базе
export const TIME_STEP = 15;

export type RequestStatus = 'done' | 'unfinished';

/** Быстрый выбор времени за смену. */
export const QUICK_TIMES: { label: string; minutes: number }[] = [
  { label: '30 мин', minutes: 30 },
  { label: '1 ч', minutes: 60 },
  { label: '2 ч', minutes: 120 },
  { label: '4 ч', minutes: 240 },
  { label: 'Вся смена', minutes: SHIFT_MINUTES },
];

/** Быстрый выбор плана для руководителя: от 30 минут до нескольких дней (день = смена). */
export const PLAN_TIMES: { label: string; minutes: number }[] = [
  { label: '30 мин', minutes: 30 },
  { label: '1 ч', minutes: 60 },
  { label: '2 ч', minutes: 120 },
  { label: '4 ч', minutes: 240 },
  { label: '1 день', minutes: SHIFT_MINUTES },
  { label: '2 дня', minutes: 2 * SHIFT_MINUTES },
  { label: '3 дня', minutes: 3 * SHIFT_MINUTES },
  { label: '5 дней', minutes: 5 * SHIFT_MINUTES },
];

/** 90 → «1 ч 30 мин», 45 → «45 мин», 0 → «0 мин». */
export function formatMinutes(m: number | null | undefined): string {
  const v = Math.max(0, Math.round(m ?? 0));
  const h = Math.floor(v / 60);
  const min = v % 60;
  if (!h) return `${min} мин`;
  return min ? `${h} ч ${min} мин` : `${h} ч`;
}

/** План: кратное смене показываем днями — «2 дня (16 ч)». */
export function formatPlan(m: number): string {
  if (m >= SHIFT_MINUTES && m % SHIFT_MINUTES === 0) {
    const d = m / SHIFT_MINUTES;
    const word = d % 10 === 1 && d % 100 !== 11 ? 'день' : [2, 3, 4].includes(d % 10) && ![12, 13, 14].includes(d % 100) ? 'дня' : 'дней';
    return `${d} ${word} (${formatMinutes(m)})`;
  }
  return formatMinutes(m);
}

/** Часы с одним знаком: 75 → «1,3». */
export const hours = (m: number) => (Math.round((m / 60) * 10) / 10).toLocaleString('ru-RU');

export const statusText: Record<RequestStatus, string> = { done: 'Выполнено', unfinished: 'Не закончено' };

/** «на 12% быстрее среднего» / «на 8% дольше среднего» / «как в среднем». */
export function ratioText(ratio: number | null): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  if (ratio == null) return { text: 'нет данных для сравнения', tone: 'neutral' };
  const diff = Math.round((1 - ratio) * 100);
  if (Math.abs(diff) < 5) return { text: 'как в среднем', tone: 'neutral' };
  return diff > 0 ? { text: `на ${diff}% быстрее среднего`, tone: 'good' } : { text: `на ${-diff}% дольше среднего`, tone: 'bad' };
}
