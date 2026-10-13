// Заявки из ITSM: выбор файла, предпросмотр, загрузка, список для мастера, назначение.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { parseItsmFile, type ItsmFile } from './itsm';
import { supabase } from './supabase';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// ---------- Файл ----------
/**
 * Руководитель выбирает файл; он читается прямо в память, без копии на телефоне.
 * null — выбор отменён.
 */
export async function pickItsmFile(): Promise<ItsmFile | null> {
  // Модули подключаются здесь: в старой версии приложения их нет — покажем понятное сообщение.
  let picker: typeof import('expo-document-picker');
  try {
    picker = require('expo-document-picker');
  } catch {
    throw new Error('Для загрузки файла нужна новая версия приложения. Установите её по ссылке от администратора.');
  }
  const res = await picker.getDocumentAsync({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
    ],
    copyToCacheDirectory: false,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  let bytes: Uint8Array;
  if (Platform.OS === 'web') {
    const file = (asset as { file?: Blob }).file;
    if (!file) throw new Error('Не удалось прочитать файл');
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const fs: typeof import('expo-file-system') = require('expo-file-system');
    bytes = await new fs.File(asset.uri).bytes();
  }
  return parseItsmFile(bytes);
}

// ---------- Предпросмотр и загрузка ----------
export type MissingRequest = { id: number; number: string; operation: string | null; description: string | null; registered_at: string | null };
export type ImportContext = {
  today: string;
  first: boolean;
  last_import_at: string | null;
  window_from: string | null;
  window_to: string | null;
  existing: string[];
  missing: MissingRequest[];
  stores: { code: string; name: string }[];
};

export const importContext = (numbers: string[]) => rpc<ImportContext>('request_import_context', { p_numbers: numbers });

export type ImportRow = {
  number: string;
  store_code: string;
  service: string | null;
  operation: string | null;
  description: string;
  status: string | null;
  registered_at: string;
  requester: string | null;
};
export type ImportPayload = {
  rows: ImportRow[];
  close_ids: number[];
  window_from: string | null;
  window_to: string | null;
  file_rows: number;
  existing_rows: number;
  outside_rows: number;
  error_rows: number;
};
export const importApply = (p: ImportPayload) =>
  rpc<{ import_id: number; inserted: number; skipped: number; closed: number }>('request_import_apply', { p });

// ---------- Список открытых заявок ----------
export type RequestFilter = 'all' | 'mine' | 'contractor';
export type OpenRequest = {
  id: number;
  number: string;
  service: string | null;
  operation: string | null;
  description: string | null;
  registered_at: string | null;
  requester_name: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  to_contractor: boolean;
  mine: boolean;
};
export const openRequests = (q: string, filter: RequestFilter) =>
  rpc<OpenRequest[]>('open_requests', { q, p_filter: filter, p_limit: 300 });

// ---------- Карточка заявки ----------
export type RequestWork = {
  work_date: string;
  name: string;
  quantity: number;
  unit: string;
  status: 'priced' | 'pending' | 'rejected';
  performers: string | null;
};
export type RequestCard = {
  id: number;
  number: string;
  source: 'manual' | 'itsm';
  subject: string | null;
  service: string | null;
  operation: string | null;
  description: string | null;
  registered_at: string | null;
  requester_name: string | null;
  is_open: boolean;
  state: 'open' | 'done' | null;
  to_contractor: boolean;
  assignee_id: number | null;
  assignee_name: string | null;
  mine: boolean;
  works: RequestWork[];
};
export const requestCard = (ref: { id?: number; number?: string }) =>
  rpc<RequestCard | null>('request_card', { p_id: ref.id ?? null, p_number: ref.number ?? null });

// ---------- Счётчики на главной мастера ----------
// «Новые» — загруженные после последнего просмотра списка; время просмотра хранится на телефоне.
const seenKey = (userId: number) => `requests-seen-v1:${userId}`;

export async function myRequestsBadge(userId: number): Promise<{ assigned: number; fresh: number }> {
  const since = await AsyncStorage.getItem(seenKey(userId)).catch(() => null);
  const rows = await rpc<{ assigned: number; fresh: number }[]>('my_requests_badge', { p_since: since });
  return rows[0] ?? { assigned: 0, fresh: 0 };
}

export function markRequestsSeen(userId: number) {
  AsyncStorage.setItem(seenKey(userId), new Date().toISOString()).catch(() => {});
}

/** Описание для списка: без вежливого вступления в начале («Добрый день!», «Здравствуйте,», «Прошу»…). */
export function previewText(text: string | null | undefined): string {
  let s = (text ?? '').trim();
  const lead = /^(добрый\s+(день|вечер)|доброе\s+утро|здравствуйте|приветствую|коллеги|прошу|просьба|просим|пожалуйста)[\s!.,:;–—-]*/i;
  for (let i = 0; i < 3 && lead.test(s); i++) s = s.replace(lead, '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : (text ?? '').trim();
}

// ---------- Руководитель ----------
export const assignRequest = (id: number, employeeId: number | null, contractor: boolean) =>
  rpc<void>('assign_request', { p_id: id, p_employee_id: employeeId, p_contractor: contractor });
export const setRequestOpen = (id: number, open: boolean) => rpc<void>('set_request_open', { p_id: id, p_open: open });

// ---------- Старые заявки: закрыть пачкой ----------
export type OldRequest = { id: number; number: string; operation: string | null; description: string | null; registered_at: string };
export const oldOpenRequests = (before: string) => rpc<OldRequest[]>('old_open_requests', { p_before: before });
export const closeOldRequests = (before: string) => rpc<number>('close_old_requests', { p_before: before });

/** «2026-10-09 14:05:00» → «09.10.2026 14:05». */
export function formatRegistered(ts: string | null | undefined): string {
  if (!ts) return '—';
  const [d, t] = ts.replace('T', ' ').split(' ');
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}${t ? ' ' + t.slice(0, 5) : ''}`;
}
