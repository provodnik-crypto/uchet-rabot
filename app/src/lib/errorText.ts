/** Распознавание ошибок без зависимостей от телефона (проверяется тестом errorText.test.ts). */
/** Вид ошибки: от него зависит текст и попадание в журнал ошибок. */
export type ErrorKind = 'network' | 'timeout' | 'updating' | 'user' | 'other';

export const MSG_NETWORK = 'Нет связи с сервером. Проверьте интернет и нажмите «Повторить».';
export const MSG_TIMEOUT = 'Сервер не ответил за 20 секунд. Проверьте интернет и нажмите «Повторить».';
export const MSG_UPDATING = 'Идёт обновление, попробуйте через минуту.';

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

export function errorCode(e: unknown): string {
  if (typeof e === 'object' && e && 'code' in e) return String((e as { code: unknown }).code ?? '');
  return '';
}

/**
 * Коды PostgREST и Postgres, которые бывают, пока меняется база или сервер перезапускается:
 * функция или таблица ещё не появилась, сервер не принимает соединения, кэш схемы перестраивается.
 */
const UPDATING_CODES = new Set([
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST202', 'PGRST204', 'PGRST205',
  '42883', '42P01', '42703', '57P01', '57P02', '57P03', '53300', '08000', '08003', '08006',
]);

export function errorKind(e: unknown): ErrorKind {
  const msg = errorMessage(e);
  const code = errorCode(e);
  if (/timeout|timed out/i.test(msg)) return 'timeout';
  if (/network request failed|failed to fetch|fetch failed|load failed|network error|aborted/i.test(msg)) return 'network';
  if (UPDATING_CODES.has(code)) return 'updating';
  if (/schema cache|could not find the (function|table)|does not exist|bad gateway|service unavailable|gateway time|upstream|<html|\b50[234]\b/i.test(msg))
    return 'updating';
  if (/invalid login credentials|already registered|duplicate key|password should be|_check|_uq\b/i.test(msg)) return 'user';
  // Своё сообщение базы на русском (raise exception …) — ожидаемый отказ, а не сбой.
  if (code === 'P0001' || !/^[\x00-\x7F]*$/.test(msg)) return 'user';
  return 'other';
}


/** Убирает из текста то, что может оказаться личным: почты, длинные числа, значения полей. */
export function sanitize(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<почта>')
    .replace(/\)=\([^)]*\)/g, ')=(…)')
    .replace(/\d[\d\s()-]{6,}\d/g, '<число>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
