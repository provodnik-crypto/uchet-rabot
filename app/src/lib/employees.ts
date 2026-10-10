import { supabase } from './supabase';

export type EmployeeRole = 'master' | 'manager' | 'service';

export type Employee = {
  id: number;
  display_name: string;
  role: EmployeeRole;
  login: string | null;
  has_account: boolean;
  is_active: boolean;
};

export const roleLabel: Record<EmployeeRole, string> = {
  master: 'Мастер',
  manager: 'Руководитель',
  service: 'Служебный',
};

export async function listEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, display_name, role, login, has_account, is_active')
    .order('is_active', { ascending: false })
    .order('role')
    .order('display_name');
  if (error) throw error;
  return data as Employee[];
}

export async function getEmployee(id: number): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, display_name, role, login, has_account, is_active')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Employee;
}

export async function renameEmployee(id: number, displayName: string) {
  const { error } = await supabase.from('employees').update({ display_name: displayName.trim() }).eq('id', id);
  if (error) throw error;
}

/** Операции с учётными записями идут через серверную функцию: им нужен сервисный ключ. */
type AdminAction =
  | { action: 'create'; employee_id?: number; display_name?: string; role?: 'master' | 'manager'; login: string; password: string }
  | { action: 'set_password'; employee_id: number; password: string }
  | { action: 'set_active'; employee_id: number; active: boolean };

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
