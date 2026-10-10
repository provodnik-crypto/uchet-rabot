/** Переводит ошибки сети и сервера в понятный текст. */
export function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/invalid login credentials/i.test(msg)) return 'Неверный логин или пароль';
  if (/network request failed|failed to fetch|fetch failed|load failed|timeout/i.test(msg))
    return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (/user already registered|already been registered|duplicate key.*login/i.test(msg)) return 'Такой логин уже занят';
  if (/password should be at least/i.test(msg)) return 'Пароль слишком короткий: нужно не меньше 6 символов';
  return msg || 'Неизвестная ошибка';
}
