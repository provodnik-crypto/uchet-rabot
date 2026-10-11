/** Переводит ошибки сети и сервера в понятный текст. */
export function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/invalid login credentials/i.test(msg)) return 'Неверный логин или пароль';
  if (/network request failed|failed to fetch|fetch failed|load failed|timeout/i.test(msg))
    return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (/user already registered|already been registered|duplicate key.*login/i.test(msg)) return 'Такой логин уже занят';
  if (/departments_name_uq/i.test(msg)) return 'Такой отдел уже существует';
  if (/employees_display_name_active_uq/i.test(msg)) return 'Сотрудник с таким именем уже есть';
  if (/employees_first_name_check/i.test(msg)) return 'В поле «Имя» — только имя, без фамилии';
  if (/employees_last_initial_check/i.test(msg)) return 'Фамилия: только первая буква';
  if (/duplicate key/i.test(msg)) return 'Такая запись уже существует';
  if (/password should be at least/i.test(msg)) return 'Пароль слишком короткий: нужно не меньше 6 символов';
  // Остальные сообщения сервера бывают на английском — не показываем их как есть.
  if (/^[\x00-\x7F]*$/.test(msg)) return 'Не удалось выполнить действие. Попробуйте ещё раз.';
  return msg || 'Неизвестная ошибка';
}
