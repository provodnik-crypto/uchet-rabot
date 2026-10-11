import { supabase } from './supabase';
import { storeToday } from './today';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// ---------- Период ----------
export type PeriodPreset = 'month' | 'prev' | 'year' | 'custom';
export type Period = { from: string; to: string };

export const periodLabel: Record<PeriodPreset, string> = {
  month: 'Этот месяц',
  prev: 'Прошлый месяц',
  year: 'Этот год',
  custom: 'Свой период',
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function presetPeriod(p: Exclude<PeriodPreset, 'custom'>): Period {
  const today = storeToday();
  const [y, m] = today.split('-').map(Number);
  if (p === 'month') return { from: iso(y, m, 1), to: today };
  if (p === 'year') return { from: iso(y, 1, 1), to: today };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return { from: iso(py, pm, 1), to: iso(py, pm, last) };
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export function monthName(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// ---------- Главная и сводки ----------
export type Dashboard = { pending_count: number; month_total_kop: number; month_entries: number };
export const managerDashboard = async () => (await rpc<Dashboard[]>('manager_dashboard'))[0];

export type EmployeeRow = { employee_id: number; display_name: string; in_output_chart: boolean; total_kop: number; entries: number; shifts: number };
export type MonthRow = { month: string; total_kop: number; entries: number };
export type Totals = { total_kop: number; entries: number; pending: number; rejected: number };

export const reportByEmployee = (p: Period) => rpc<EmployeeRow[]>('report_by_employee', { p_from: p.from, p_to: p.to });
export const reportByMonth = (p: Period) => rpc<MonthRow[]>('report_by_month', { p_from: p.from, p_to: p.to });
export const reportTotals = async (p: Period) => (await rpc<Totals[]>('report_totals', { p_from: p.from, p_to: p.to }))[0];

// ---------- Очередь «На оценке» ----------
export type PendingRow = {
  entry_id: number;
  work_date: string;
  submitted_at: string;
  request_number: string | null;
  department_name: string;
  custom_name: string;
  unit_id: number;
  unit_code: string;
  quantity: number;
  note: string | null;
  author_name: string;
  performer_names: string;
  hint_price_kop: number | null;
  hint_date: string | null;
};

export const pendingQueue = () => rpc<PendingRow[]>('pending_queue');
export const pricePendingEntry = (entryId: number, unitPriceKop: number, addToPrice: boolean) =>
  rpc<void>('price_pending_entry', { p_entry: entryId, p_unit_price_kop: unitPriceKop, p_add_to_price: addToPrice });
export const replaceEntryWithItem = (entryId: number, itemId: number, quantity: number | null) =>
  rpc<void>('replace_entry_with_item', { p_entry: entryId, p_item: itemId, p_quantity: quantity });
export const rejectEntry = (entryId: number, comment: string) => rpc<void>('reject_entry', { p_entry: entryId, p_comment: comment });

// ---------- Журнал работ ----------
export type EntryStatus = 'priced' | 'pending' | 'rejected';
export type AdminEntry = {
  entry_id: number;
  shift_id: number;
  work_date: string;
  request_number: string | null;
  department_id: number;
  department_name: string;
  price_item_id: number | null;
  name: string;
  is_custom: boolean;
  unit_code: string;
  integer_only: boolean;
  quantity: number;
  note: string | null;
  status: EntryStatus;
  reject_comment: string | null;
  is_imported: boolean;
  unit_price_kop: number | null;
  total_kop: number | null;
  performer_ids: number[];
  performer_names: string;
  author_name: string;
  total_rows: number;
};

export type EntryFilters = {
  period: Period;
  employeeId: number | null;
  departmentId: number | null;
  request: string;
  status: EntryStatus | null;
};

export const ENTRIES_PAGE = 50;

export const adminEntries = (f: EntryFilters, offset = 0) =>
  rpc<AdminEntry[]>('admin_entries', {
    p_from: f.period.from,
    p_to: f.period.to,
    p_employee: f.employeeId,
    p_department: f.departmentId,
    p_request: f.request.trim() || null,
    p_status: f.status,
    p_limit: ENTRIES_PAGE,
    p_offset: offset,
  });

export const adminUpdateEntry = (entryId: number, quantity: number, departmentId: number, note: string, performerIds: number[]) =>
  rpc<void>('admin_update_entry', { p_entry: entryId, p_quantity: quantity, p_department: departmentId, p_note: note, p_performer_ids: performerIds });
export const adminDeleteEntry = (entryId: number) => rpc<void>('admin_delete_entry', { p_entry: entryId });

export async function listPerformers(): Promise<{ id: number; display_name: string; role: string; is_active: boolean }[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, display_name, role, is_active')
    .in('role', ['master', 'service'])
    .order('role')
    .order('display_name');
  if (error) throw error;
  return data;
}

// ---------- Заявки ----------
export type RequestRow = {
  id: number;
  number: string;
  requester: string | null;
  registered_at: string | null;
  subject: string | null;
  state: string | null;
  note: string | null;
  entries: number;
  last_work_date: string | null;
};

export const listRequests = (q: string) => rpc<RequestRow[]>('list_requests', { q, p_limit: 200 });

export async function updateRequest(id: number, patch: Partial<Pick<RequestRow, 'requester' | 'registered_at' | 'subject' | 'state' | 'note'>>) {
  const { error } = await supabase.from('requests').update(patch).eq('id', id);
  if (error) throw error;
}

export async function addRequest(number: string) {
  const { data, error } = await supabase.from('requests').insert({ number }).select('id').single();
  if (error) throw error;
  return data.id as number;
}
