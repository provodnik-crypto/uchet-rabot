import { supabase } from './supabase';

export type Unit = { id: number; code: string; integer_only: boolean };

export type PriceFilter = 'active' | 'inactive' | 'material' | 'all';

export const priceFilterLabel: Record<PriceFilter, string> = {
  active: 'Активные',
  inactive: 'Выключенные',
  material: 'Материалы',
  all: 'Все',
};

/** Строка прайса для руководителя (с ценой). */
export type AdminPriceItem = {
  id: number;
  short_name: string;
  full_name: string;
  category: string;
  subcategory: string | null;
  unit_id: number;
  unit_code: string;
  is_active: boolean;
  is_material: boolean;
  origin: 'csv' | 'manual';
  price_kop: number | null;
  price_valid_from: string | null;
  total: number;
};

export type PriceHistoryRow = { id: number; price_kop: number; valid_from: string; price_list_id: number | null; created_at: string };

export const PAGE_SIZE = 50;

export async function listUnits(): Promise<Unit[]> {
  const { data, error } = await supabase.from('units').select('id, code, integer_only').order('sort');
  if (error) throw error;
  return data as Unit[];
}

export async function adminPriceItems(q: string, filter: PriceFilter, offset = 0): Promise<AdminPriceItem[]> {
  const { data, error } = await supabase.rpc('admin_price_items', { q, p_filter: filter, p_limit: PAGE_SIZE, p_offset: offset });
  if (error) throw error;
  return data as AdminPriceItem[];
}

export async function getAdminPriceItem(id: number): Promise<{ item: AdminPriceItem; history: PriceHistoryRow[] }> {
  const { data, error } = await supabase.rpc('admin_price_items', { q: '', p_filter: 'all', p_limit: 1, p_offset: 0, p_id: id });
  if (error) throw error;
  const item = (data as AdminPriceItem[])[0];
  if (!item) throw new Error('Позиция прайса не найдена');
  const { data: history, error: e2 } = await supabase
    .from('price_item_prices')
    .select('id, price_kop, valid_from, price_list_id, created_at')
    .eq('price_item_id', id)
    .order('valid_from', { ascending: false });
  if (e2) throw e2;
  return { item, history: history as PriceHistoryRow[] };
}

export async function updatePriceItem(
  id: number,
  patch: Partial<Pick<AdminPriceItem, 'short_name' | 'unit_id' | 'is_active' | 'is_material'>>,
) {
  const { error } = await supabase.from('price_items').update(patch).eq('id', id);
  if (error) throw error;
}

/** validFrom: ГГГГ-ММ-ДД или null (с сегодняшнего дня по времени магазина). */
export async function setPrice(id: number, priceKop: number, validFrom: string | null) {
  const { error } = await supabase.rpc('admin_set_price', { p_item: id, p_price_kop: priceKop, p_valid_from: validFrom });
  if (error) throw error;
}
