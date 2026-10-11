// Управление учётными записями сотрудников. Вызывает только руководитель.
// Нужна отдельная функция: создавать пользователей и менять пароли можно лишь сервисным ключом,
// а он не должен попадать в приложение.
import { createClient } from 'npm:@supabase/supabase-js@2';

// Та же логика, что в app/src/lib/login.ts — меняйте вместе.
const LOGIN_DOMAIN = 'uchet.local';
const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const BAN_FOREVER = '876000h';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function requireManager(req: Request): Promise<number> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await caller.rpc('whoami');
  const me = Array.isArray(data) ? data[0] : data;
  if (error || !me || me.role !== 'manager') throw new HttpError(403, 'Доступно только руководителю');
  return me.id;
}

async function loadEmployee(id: number) {
  const { data, error } = await admin.from('employees').select('id, role, user_id, login, is_active').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Сотрудник не найден');
  return data;
}

function checkPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < 6) throw new HttpError(400, 'Пароль: не меньше 6 символов');
  return p;
}

async function create(body: Record<string, unknown>) {
  const login = String(body.login ?? '').trim().toLowerCase();
  if (!LOGIN_PATTERN.test(login)) throw new HttpError(400, 'Логин: от 3 до 32 латинских букв или цифр (можно . _ -)');
  const password = checkPassword(body.password);

  const { data: taken } = await admin.from('employees').select('id').eq('login', login).maybeSingle();
  if (taken) throw new HttpError(409, 'Такой логин уже занят');

  let employeeId: number;
  let createdEmployee = false;
  if (body.employee_id) {
    const emp = await loadEmployee(Number(body.employee_id));
    if (emp.role === 'service') throw new HttpError(400, 'Служебному сотруднику вход не нужен');
    if (emp.user_id) throw new HttpError(409, 'У сотрудника уже есть учётная запись');
    employeeId = emp.id;
  } else {
    // Только имя и первая буква фамилии: полные ФИО не храним. Имя для отчётов («Иван П.») собирает база.
    const firstName = String(body.first_name ?? '').trim();
    const initial = String(body.last_initial ?? '').trim().toUpperCase() || null;
    const role = body.role === 'manager' ? 'manager' : 'master';
    if (!firstName) throw new HttpError(400, 'Введите имя');
    if (/\s/.test(firstName)) throw new HttpError(400, 'В поле «Имя» — только имя, без фамилии');
    if (initial && !/^[А-ЯЁA-Z]$/.test(initial)) throw new HttpError(400, 'Фамилия: только первая буква');
    const { data, error } = await admin.from('employees').insert({ first_name: firstName, last_initial: initial, role }).select('id').single();
    if (error) {
      throw error;
    }
    employeeId = data.id;
    createdEmployee = true;
  }

  const { data: user, error: userErr } = await admin.auth.admin.createUser({
    email: `${login}@${LOGIN_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { login },
  });
  if (userErr || !user.user) {
    if (createdEmployee) await admin.from('employees').delete().eq('id', employeeId);
    throw new HttpError(400, userErr?.message ?? 'Не удалось создать учётную запись');
  }

  const { error: linkErr } = await admin.from('employees').update({ user_id: user.user.id, login }).eq('id', employeeId);
  if (linkErr) {
    await admin.auth.admin.deleteUser(user.user.id);
    if (createdEmployee) await admin.from('employees').delete().eq('id', employeeId);
    throw linkErr;
  }
  return { employee_id: employeeId };
}

async function setPassword(body: Record<string, unknown>) {
  const emp = await loadEmployee(Number(body.employee_id));
  if (!emp.user_id) throw new HttpError(400, 'У сотрудника нет учётной записи');
  const { error } = await admin.auth.admin.updateUserById(emp.user_id, { password: checkPassword(body.password) });
  if (error) throw new HttpError(400, error.message);
  return { employee_id: emp.id };
}

async function setActive(body: Record<string, unknown>, callerId: number) {
  const emp = await loadEmployee(Number(body.employee_id));
  if (emp.id === callerId) throw new HttpError(400, 'Нельзя отключить самого себя');
  if (emp.role === 'service') throw new HttpError(400, 'Служебного сотрудника отключать не нужно');
  const active = body.active === true;
  if (emp.user_id) {
    // Блокировка в Auth сразу закрывает вход; история работ сотрудника остаётся.
    const { error } = await admin.auth.admin.updateUserById(emp.user_id, { ban_duration: active ? 'none' : BAN_FOREVER });
    if (error) throw new HttpError(400, error.message);
  }
  const { error } = await admin.from('employees').update({ is_active: active }).eq('id', emp.id);
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Уже есть активный сотрудник с таким именем');
    throw error;
  }
  return { employee_id: emp.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Только POST' }, 405);
  try {
    const callerId = await requireManager(req);
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case 'create':
        return json(await create(body));
      case 'set_password':
        return json(await setPassword(body));
      case 'set_active':
        return json(await setActive(body, callerId));
      default:
        throw new HttpError(400, 'Неизвестное действие');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Ошибка сервера' }, 500);
  }
});
