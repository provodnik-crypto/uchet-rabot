// Создаёт первого руководителя (дальше сотрудников заводит он сам в приложении).
// Запуск: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/create-manager.mjs "Имя" login
// Пароль генерируется и печатается один раз; после входа его можно сменить в разделе «Сотрудники».
import { randomInt } from 'node:crypto';

const [name, login] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!name || !login || !url || !key) {
  console.error('Нужно: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и аргументы "Имя" login');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(login)) {
  console.error('Логин: от 3 до 32 латинских букв или цифр');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function call(path, init) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body}`);
  return body ? JSON.parse(body) : null;
}

const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
const password = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');

const user = await call('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email: `${login}@uchet.local`, password, email_confirm: true, user_metadata: { login } }),
});
const [emp] = await call('/rest/v1/employees', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ display_name: name, role: 'manager', user_id: user.id, login }),
});
console.log(`Руководитель создан: ${emp.display_name} (id ${emp.id})`);
console.log(`Логин: ${login}`);
console.log(`Пароль: ${password}`);
