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

// ---------- Инициаторы: слот создаёт руководитель, пароль инициатор задаёт сам по LDAP ----------

const LDAP_PATTERN = /^\d{3,20}$/;

/** Руководитель создаёт «слот»: имя, отдел, LDAP, градация. Без пароля — его придумает инициатор. */
async function addInitiator(body: Record<string, unknown>) {
  const firstName = String(body.first_name ?? '').trim();
  const initial = String(body.last_initial ?? '').trim().toUpperCase() || null;
  const grade = Number(body.grade);
  const ldap = String(body.ldap ?? '').trim();
  const departmentId = Number(body.department_id);
  const workPhone = String(body.work_phone ?? '').trim() || null;
  if (!firstName) throw new HttpError(400, 'Введите имя');
  if (/\s/.test(firstName)) throw new HttpError(400, 'В поле «Имя» — только имя, без фамилии');
  if (initial && !/^[А-ЯЁA-Z]$/.test(initial)) throw new HttpError(400, 'Фамилия: только первая буква');
  if (grade !== 1 && grade !== 2 && grade !== 3) throw new HttpError(400, 'Выберите, кто это: сотрудник, менеджер отдела или руководитель сектора');
  if (!LDAP_PATTERN.test(ldap)) throw new HttpError(400, 'LDAP: от 3 до 20 цифр');
  if (!departmentId) throw new HttpError(400, 'Выберите отдел');
  if (grade >= 2 && !/^031\d{3}$/.test(workPhone ?? '')) {
    throw new HttpError(400, 'Рабочий телефон 031XXX — у менеджера отдела и руководителя сектора он обязателен');
  }
  if (grade === 1 && workPhone) throw new HttpError(400, 'Рабочий телефон — только менеджеру отдела и руководителю сектора');

  const { data: taken } = await admin.from('employees').select('id').eq('ldap_code', ldap).maybeSingle();
  if (taken) throw new HttpError(409, 'Такой LDAP уже записан');
  const { data: loginTaken } = await admin.from('employees').select('id').eq('login', ldap).maybeSingle();
  if (loginTaken) throw new HttpError(409, 'Такой логин уже занят');

  const { data: dept } = await admin.from('departments').select('id').eq('id', departmentId).eq('is_active', true).maybeSingle();
  if (!dept) throw new HttpError(400, 'Отдел не найден');

  const { data, error } = await admin.from('employees').insert({
    first_name: firstName, last_initial: initial, role: 'initiator', grade,
    ldap_code: ldap, department_id: departmentId, work_phone: grade >= 2 ? workPhone : null,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Такой LDAP уже записан');
    throw error;
  }
  return { employee_id: data.id };
}

/** Первый вход инициатора: LDAP + придуманный пароль. Без руководителя, с защитой от подбора. */
async function claimInitiator(body: Record<string, unknown>, req: Request) {
  const ldap = String(body.ldap ?? '').trim();
  const password = checkPassword(body.password);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;

  // защита от подбора: не больше 5 попыток в час на один LDAP, 20 в час с одного адреса
  await admin.from('claim_attempts').insert({ ldap, ip });
  await admin.from('claim_attempts').delete().lt('attempted_at', new Date(Date.now() - 86400000).toISOString());
  const { count: byLdap } = await admin.from('claim_attempts').select('*', { count: 'exact', head: true })
    .eq('ldap', ldap).gte('attempted_at', new Date(Date.now() - 3600000).toISOString());
  const { count: byIp } = await admin.from('claim_attempts').select('*', { count: 'exact', head: true })
    .eq('ip', ip ?? '\u0000').gte('attempted_at', new Date(Date.now() - 3600000).toISOString());
  if ((byLdap ?? 0) > 5 || (byIp ?? 0) > 20) throw new HttpError(429, 'Слишком много попыток — попробуйте через час');

  const { data: emp, error: empErr } = await admin.from('employees')
    .select('id, user_id, login, is_active').eq('ldap_code', ldap).eq('role', 'initiator').maybeSingle();
  if (empErr) throw empErr;
  if (!emp || !emp.is_active || emp.user_id) throw new HttpError(400, 'Не найден или уже занят — уточните LDAP у руководителя');

  const login = ldap; // цифры проходят шаблон логина
  const { data: user, error: userErr } = await admin.auth.admin.createUser({
    email: `${login}@${LOGIN_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { login },
  });
  if (userErr || !user.user) throw new HttpError(400, 'Не найден или уже занят — уточните LDAP у руководителя');

  const { error: linkErr } = await admin.from('employees').update({ user_id: user.user.id, login }).eq('id', emp.id);
  if (linkErr) {
    await admin.auth.admin.deleteUser(user.user.id);
    throw new HttpError(400, 'Не удалось создать учётную запись, попробуйте ещё раз');
  }
  return { employee_id: emp.id };
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
    const body = await req.json().catch(() => ({}));
    if (body.action === 'claim_initiator') return json(await claimInitiator(body, req));
    const callerId = await requireManager(req);
    switch (body.action) {
      case 'create':
        return json(await create(body));
      case 'add_initiator':
        return json(await addInitiator(body));
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
