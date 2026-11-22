import { supabase } from './supabase';

export type EmployeeRole = 'master' | 'manager' | 'service' | 'initiator';

export type Employee = {
  id: number;
  display_name: string;
  first_name: string;
  last_initial: string | null;
  icon: number | null;
  role: EmployeeRole;
  login: string | null;
  has_account: boolean;
  is_active: boolean;
  grade: number | null;
  work_phone: string | null;
  ldap_code: string | null;
};

export const roleLabel: Record<EmployeeRole, string> = {
  master: 'Мастер',
  manager: 'Руководитель',
  service: 'Служебный',
  initiator: 'Инициатор',
};

export async function listEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, display_name, first_name, last_initial, icon, role, login, has_account, is_active, grade, work_phone, ldap_code')
    .order('is_active', { ascending: false })
    .order('role')
    .order('display_name');
  if (error) throw error;
  return data as Employee[];
}

export async function getEmployee(id: number): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, display_name, first_name, last_initial, icon, role, login, has_account, is_active, grade, work_phone, ldap_code')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Employee;
}

/** Только имя и первая буква фамилии: полные ФИО не храним (серверы за рубежом). */
export const nameError = (firstName: string) =>
  !firstName.trim() ? 'Введите имя' : /\s/.test(firstName.trim()) ? 'Только имя, без фамилии' : null;
export const initialError = (initial: string) =>
  !initial.trim() || /^[А-ЯЁA-Z]$/i.test(initial.trim()) ? null : 'Одна буква';

export async function updateEmployee(id: number, patch: { first_name?: string; last_initial?: string | null; icon?: number }) {
  const { error } = await supabase.from('employees').update(patch).eq('id', id);
  if (error) throw error;
}

/** Операции с учётными записями идут через серверную функцию: им нужен сервисный ключ. */
type AdminAction =
  | { action: 'create'; employee_id?: number; first_name?: string; last_initial?: string | null; role?: 'master' | 'manager'; login: string; password: string }
  | { action: 'set_password'; employee_id: number; password: string }
  | { action: 'set_active'; employee_id: number; active: boolean }
  | {
      action: 'add_initiator';
      first_name: string;
      last_initial?: string | null;
      grade: number;
      ldap: string;
      department_id: number;
      work_phone?: string | null;
    }
  | { action: 'claim_initiator'; ldap: string; password: string };

export async function adminUsers(body: AdminAction): Promise<{ employee_id: number }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // Текст ошибки функции лежит в теле ответа.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) throw new Error(payload.error);
    }
    throw error;
  }
  return data;
}
