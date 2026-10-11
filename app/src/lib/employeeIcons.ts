import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Значок сотрудника (1–12, рисунки — в toolIcons.ts) вместо фото: фото людей не храним.
 * Список маленький, загружается один раз и обновляется при каждом открытии экрана.
 */
let cache: Record<number, number> = {};
const listeners = new Set<(v: Record<number, number>) => void>();

export async function refreshEmployeeIcons() {
  const { data } = await supabase.from('employees').select('id, icon');
  if (!data) return;
  cache = Object.fromEntries(data.filter((e) => e.icon).map((e) => [e.id as number, e.icon as number]));
  listeners.forEach((l) => l(cache));
}

/** id сотрудника → номер значка. */
export function useEmployeeIcons(): Record<number, number> {
  const [icons, setIcons] = useState(cache);
  useEffect(() => {
    listeners.add(setIcons);
    refreshEmployeeIcons().catch(() => {});
    return () => {
      listeners.delete(setIcons);
    };
  }, []);
  return icons;
}
