const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Простой пароль для выдачи сотруднику: 8 символов без похожих букв (l/1, o/0). */
export function generatePassword(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function passwordError(p: string): string | null {
  if (p.length < 6) return 'Пароль: не меньше 6 символов';
  return null;
}
