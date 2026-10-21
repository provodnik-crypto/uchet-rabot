import { supabase } from './supabase';

/** Работа для выбора мастером (без цены). */
export type WorkItem = {
  id: number;
  short_name: string;
  category: string;
  subcategory: string | null;
  unit_id: number;
  unit_code: string;
  integer_only: boolean;
};

export type CategoryRow = { category: string; subcategory: string | null; items: number };

export type Suggestion = {
  kind: 'price' | 'custom';
  price_item_id: number | null;
  name: string;
  category: string | null;
  unit_id: number;
  unit_code: string;
};

export type Person = { id: number; display_name: string };
export type DepartmentOption = { id: number; name: string; is_default: boolean };

/** Строка истории мастера: одна работа. Денег здесь нет и быть не может. */
export type MyEntry = {
  shift_id: number;
  client_uuid: string | null;
  work_date: string;
  submitted_at: string;
  can_edit: boolean;
  entry_id: number;
  entry_position: number;
  request_number: string | null;
  department_id: number;
  department_name: string;
  price_item_id: number | null;
  name: string;
  category: string | null;
  is_custom: boolean;
  unit_id: number;
  unit_code: string;
  integer_only: boolean;
  quantity: number;
  note: string | null;
  status: 'priced' | 'pending' | 'rejected' | 'awaiting';
  reject_comment: string | null;
  performer_ids: number[];
  performer_names: string;
};

export const statusLabel: Record<MyEntry['status'], string> = {
  priced: 'Принято',
  pending: 'На оценке',
  rejected: 'Отклонено',
  awaiting: 'Ждёт приёмки',
};

export type SubmitEntry = {
  request_number: string | null;
  department_id: number;
  price_item_id?: number;
  custom_name?: string;
  unit_id?: number;
  quantity: number;
  note: string | null;
  performer_ids: number[];
  photos?: { path?: string; thumb_path?: string; width: number | null; height: number | null; size_bytes: number | null }[];
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const searchWork = (q: string, category: string | null = null, subcategory: string | null = null, limit = 50) =>
  rpc<WorkItem[]>('search_price_items', { q, p_category: category, p_subcategory: subcategory, p_limit: limit });
export const workCategories = () => rpc<CategoryRow[]>('price_categories');
export const myWorkItems = (mode: 'frequent' | 'recent') => rpc<WorkItem[]>('my_price_items', { p_mode: mode, p_limit: 15 });
export const myRecentRequests = async () => (await rpc<{ number: string }[]>('my_recent_requests', { p_limit: 8 })).map((r) => r.number);
export const suggestCustomNames = (q: string) => rpc<Suggestion[]>('suggest_custom_names', { q });
export const myEntries = (days = 60) => rpc<MyEntry[]>('my_entries', { p_days: days });

/** Время и статус по заявке за смену; request_number null — работы без заявки. */
export type SubmitRequest = { request_number: string | null; minutes: number; status?: 'done' | 'unfinished' };

/** Незаконченная заявка, которая переходит к мастеру в следующую смену. */
export type OpenRequest = { number: string; since: string; last_date: string; spent_minutes: number; entries: number; plan_minutes: number | null };

export const myOpenRequests = () => rpc<OpenRequest[]>('my_open_requests');
export const myShiftRequests = (clientUuid: string) =>
  rpc<{ request_number: string | null; minutes: number; status: 'done' | 'unfinished' | null }[]>('my_shift_requests', { p_client_uuid: clientUuid });

export function submitShift(payload: { client_uuid: string; work_date: string; entries: SubmitEntry[]; requests?: SubmitRequest[] }) {
  return rpc<{ shift_id: number; entries: number; pending: number }>('submit_shift', { payload });
}

export async function listMasters(): Promise<Person[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, display_name')
    .eq('role', 'master')
    .eq('is_active', true)
    .order('display_name');
  if (error) throw error;
  return data as Person[];
}

export async function listActiveDepartments(): Promise<DepartmentOption[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, is_default')
    .eq('is_active', true)
    .order('sort')
    .order('name');
  if (error) throw error;
  return data as DepartmentOption[];
}

// ---------- Номер заявки ----------
export type RequestPrefix = 'RFS' | 'INC';

/** Мастер набирает только 10 цифр; подчёркивание ставится само: «2604232283» → «260423_2283». */
export function formatRequestDigits(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  return d.length > 6 ? `${d.slice(0, 6)}_${d.slice(6)}` : d;
}

export function requestNumber(prefix: RequestPrefix, digits: string): string {
  return prefix + formatRequestDigits(digits);
}

/** null — номер верный, иначе понятная подсказка. */
export function requestError(digits: string): string | null {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 10) return `Нужно 10 цифр: 6 цифр даты и 4 цифры номера (набрано ${d.length})`;
  const mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return 'Первые 6 цифр — дата заявки ГГММДД, например 260423';
  return null;
}

// ---------- Объём ----------
/** Объём из поля ввода: «1,5» → 1.5. null с пояснением, если не подходит. */
export function parseQuantity(raw: string, integerOnly: boolean): { value: number | null; error: string | null } {
  const s = raw.trim().replace(',', '.');
  if (!s) return { value: null, error: 'Введите объём' };
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return { value: null, error: 'Объём — число, не больше 3 знаков после запятой' };
  const v = Number(s);
  if (!(v > 0)) return { value: null, error: 'Объём должен быть больше нуля' };
  if (integerOnly && !Number.isInteger(v)) return { value: null, error: 'Для штук — только целое число' };
  return { value: v, error: null };
}

export function formatQuantity(q: number | string): string {
  return String(Number(q)).replace('.', ',');
}

/** Исправить отклонённую работу и отправить снова на оценку. */
export const resubmitEntry = (
  entryId: number,
  customName: string,
  unitId: number,
  quantity: number,
  note: string,
  photos: SubmitEntry['photos'],
  /** Работа из прайса остаётся из прайса (цена — по прайсу, без ручной оценки). */
  priceItemId: number | null = null,
) =>
  rpc<void>('resubmit_entry', {
    p_entry: entryId,
    p_custom_name: customName,
    p_unit_id: unitId,
    p_quantity: quantity,
    p_note: note,
    p_price_item_id: priceItemId,
    p_photos: photos ?? [],
  });

// ---------- Итоги для мастера (без цен отдельных работ) ----------
export type MyMonthSummary = { total_kop: number; requests: number; entries: number; pending: number; awaiting?: number };
export type TeamRow = { employee_id: number; display_name: string; total_kop: number; entries: number; requests: number };
export type TeamMonthRow = { month: string; employee_id: number; display_name: string; total_kop: number };

export const myMonthSummary = async () => (await rpc<MyMonthSummary[]>('my_month_summary'))[0];
export const teamRating = (from: string, to: string) => rpc<TeamRow[]>('team_rating', { p_from: from, p_to: to });
export const teamByMonth = (from: string, to: string) => rpc<TeamMonthRow[]>('team_by_month', { p_from: from, p_to: to });
