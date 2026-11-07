import { supabase } from './supabase';

export type Department = { id: number; name: string; is_default: boolean; is_active: boolean; sort: number };

export async function listDepartments(): Promise<Department[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, is_default, is_active, sort')
    .order('is_active', { ascending: false })
    .order('sort')
    .order('name');
  if (error) throw error;
  return data as Department[];
}

/**
 * Старый отдел «Магазин»: мастер его больше не выбирает, в фильтрах «Магазин» — это весь магазин.
 * Записи прошлых лет с этим отделом остаются как есть.
 */
export const isWholeStore = (d: Pick<Department, 'name'>) => d.name.trim().toLowerCase() === 'магазин';

export async function getDepartment(id: number): Promise<Department> {
  const { data, error } = await supabase.from('departments').select('id, name, is_default, is_active, sort').eq('id', id).single();
  if (error) throw error;
  return data as Department;
}

/** Первая буква заглавная, лишние пробелы убраны: «  плитка » → «Плитка». */
export function cleanDepartmentName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.charAt(0).toLocaleUpperCase('ru-RU') + s.slice(1);
}

export async function addDepartment(name: string) {
  const { error } = await supabase.from('departments').insert({ name: cleanDepartmentName(name) });
  if (error) throw error;
}

export async function updateDepartment(id: number, patch: Partial<Pick<Department, 'name' | 'is_active'>>) {
  const body = patch.name !== undefined ? { ...patch, name: cleanDepartmentName(patch.name) } : patch;
  const { error } = await supabase.from('departments').update(body).eq('id', id);
  if (error) throw error;
}

export async function setDefaultDepartment(id: number) {
  const { error } = await supabase.rpc('set_default_department', { p_id: id });
  if (error) throw error;
}
