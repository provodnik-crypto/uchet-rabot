/**
 * Supabase Auth работает с e-mail, а у сотрудников короткие логины («kolya»).
 * Логин превращается во внутренний адрес вида kolya@uchet.local; пользователь его не видит.
 * Та же логика продублирована в supabase/functions/admin-users — меняйте вместе.
 */
export const LOGIN_DOMAIN = 'uchet.local';
export const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeLogin(raw: string): string {
  return raw.trim().toLowerCase();
}

export function loginError(raw: string): string | null {
  const login = normalizeLogin(raw);
  if (!login) return 'Введите логин';
  if (!LOGIN_PATTERN.test(login)) return 'Логин: от 3 до 32 латинских букв или цифр (можно . _ -)';
  return null;
}

export function loginToEmail(raw: string): string {
  return `${normalizeLogin(raw)}@${LOGIN_DOMAIN}`;
}
