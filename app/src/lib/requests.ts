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
  /** Срок ITSM («Время разрешения»), местное время. */
  due_at: string | null;
};
export type ImportPayload = {
  rows: ImportRow[];
  /** Сроки уже загруженных заявок (меняется только срок). */
  due_updates: { number: string; due_at: string }[];
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
// ---------- Статусы и приоритет ----------
export type LifecycleStatus = 'waiting' | 'in_work' | 'review' | 'accepted' | 'contractor';
export const lifecycleLabel: Record<LifecycleStatus, string> = {
  waiting: 'Ожидает',
  in_work: 'В работе',
  review: 'На проверке',
  accepted: 'Принята',
  contractor: 'У подрядчика',
};
/** 1 — срочно … 4 — низкий. */
export type Priority = 1 | 2 | 3 | 4;
export const priorityLabel: Record<Priority, string> = { 1: 'Срочно', 2: 'Высокий', 3: 'Обычный', 4: 'Низкий' };
/** Цвет метки приоритета (обычный не показываем). Подрядчик — отдельный фиолетовый, чтобы не путать. */
export const priorityColor: Record<Priority, string> = { 1: '#C62828', 2: '#E65100', 3: '#595959', 4: '#757575' };
export const CONTRACTOR_COLOR = '#5E35B1';

/** Примерное время при взятии заявки. */
export const ESTIMATES: { label: string; minutes: number }[] = [
  { label: '30 мин', minutes: 30 },
  { label: '1 ч', minutes: 60 },
  { label: '2 ч', minutes: 120 },
  { label: '4 ч', minutes: 240 },
  { label: '1 день', minutes: 480 },
  { label: '2–3 дня', minutes: 1200 },
];

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
  /** Назначена мне или я взял. */
  mine: boolean;
  status: LifecycleStatus;
  priority: Priority;
  responsible_id: number | null;
  responsible_name: string | null;
  plan_minutes: number | null;
  spent_minutes: number;
  returned: boolean;
  /** Я напарник по заявке. */
  member: boolean;
  /** Новые сообщения и важные события от других. */
  unread: number;
  /** Срок ITSM, местное время. */
  due_at: string | null;
};
export const openRequests = (q: string, filter: RequestFilter) =>
  rpc<OpenRequest[]>('open_requests', { q, p_filter: filter, p_limit: 300 });

// ---------- Карточка заявки ----------
export type RequestWork = {
  work_date: string;
  name: string;
  quantity: number;
  unit: string;
  status: 'priced' | 'pending' | 'rejected' | 'awaiting';
  performers: string | null;
  /** client_uuid смены, в которой внесена работа. */
  shift_uuid?: string;
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
  due_at?: string | null;
  requester_name: string | null;
  is_open: boolean;
  state: 'open' | 'done' | null;
  to_contractor: boolean;
  assignee_id: number | null;
  assignee_name: string | null;
  mine: boolean;
  works: RequestWork[];
  status: LifecycleStatus;
  priority: Priority;
  plan_minutes: number | null;
  responsible_id: number | null;
  responsible_name: string | null;
  is_responsible: boolean;
  taken_at: string | null;
  sent_at: string | null;
  returned_comment: string | null;
  members: { id: number; name: string }[];
  spent_minutes: number;
  time_by_day: { work_date: string; minutes: number; author: string; shift_uuid?: string }[];
  events: RequestEvent[];
};
export type RequestEvent = {
  kind: 'take' | 'refuse' | 'send' | 'accept' | 'return' | 'priority' | 'assign' | 'responsible' | 'contractor' | 'plan' | 'migrate' | 'comment' | 'create';
  at: string;
  from: LifecycleStatus | null;
  to: LifecycleStatus | null;
  comment: string | null;
  author: string | null;
  /** Моё сообщение или действие. */
  mine?: boolean;
};
export const eventLabel: Record<RequestEvent['kind'], string> = {
  take: 'Взял в работу',
  refuse: 'Отказался',
  send: 'Отправил на проверку',
  accept: 'Принял',
  return: 'Вернул',
  priority: 'Приоритет',
  assign: 'Назначение',
  responsible: 'Ответственный',
  contractor: 'Передал подрядчику',
  plan: 'Примерное время',
  migrate: 'Перенос в новую схему',
  comment: 'Сообщение',
  create: 'Создал заявку',
};

/** Подпись события; незнакомое (из новой версии базы) не роняет экран. */
export const eventText = (kind: string) => ((eventLabel as Record<string, string>)[kind] ?? 'Событие').toLowerCase();

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

// ---------- Жизненный цикл ----------
export type MyRequest = {
  id: number;
  number: string;
  operation: string | null;
  description: string | null;
  status: LifecycleStatus;
  priority: Priority;
  plan_minutes: number | null;
  spent_minutes: number;
  taken_at: string | null;
  returned_comment: string | null;
  responsible: boolean;
  responsible_name: string | null;
  unread: number;
  due_at: string | null;
};
export const myRequests = () => rpc<MyRequest[]>('my_requests');
export const takeRequest = (id: number, planMinutes: number | null, memberIds: number[]) =>
  rpc<void>('take_request', { p_id: id, p_plan_minutes: planMinutes, p_member_ids: memberIds });
export const refuseRequest = (id: number, comment: string) => rpc<void>('refuse_request', { p_id: id, p_comment: comment });
export const sendRequestForReview = (id: number, comment: string | null) =>
  rpc<void>('send_request_for_review', { p_id: id, p_comment: comment });
export const acceptRequest = (id: number, comment: string | null) => rpc<void>('accept_request', { p_id: id, p_comment: comment });
export const returnRequest = (id: number, comment: string) => rpc<void>('return_request', { p_id: id, p_comment: comment });
export const setRequestPriority = (id: number, priority: Priority) => rpc<void>('set_request_priority', { p_id: id, p_priority: priority });
export const setRequestResponsible = (id: number, employeeId: number | null) =>
  rpc<void>('set_request_responsible', { p_id: id, p_employee: employeeId });
export const reviewCount = () => rpc<number>('review_count');

// ---------- Переписка и уведомления ----------
export const addRequestComment = (id: number, text: string) => rpc<void>('add_request_comment', { p_id: id, p_text: text });
export const markRequestRead = (id: number) => rpc<void>('mark_request_read', { p_id: id }).catch(() => {});
export type Notifications = {
  unread: { id: number; number: string; count: number; refused?: boolean }[];
  returned?: { id: number; number: string; comment: string }[];
  urgent?: { id: number; number: string; operation: string | null; status: LifecycleStatus }[];
  /** Руководителю: заявок «В работе» без действий больше 3 рабочих дней. */
  stale?: number;
};
export const myNotifications = () => rpc<Notifications>('my_notifications');

// ---------- Руководитель ----------
export const assignRequest = (id: number, employeeId: number | null, contractor: boolean) =>
  rpc<void>('assign_request', { p_id: id, p_employee_id: employeeId, p_contractor: contractor });
export const setRequestOpen = (id: number, open: boolean) => rpc<void>('set_request_open', { p_id: id, p_open: open });

// ---------- Старые заявки: закрыть пачкой ----------
export type OldRequest = { id: number; number: string; operation: string | null; description: string | null; registered_at: string };
export const oldOpenRequests = (before: string) => rpc<OldRequest[]>('old_open_requests', { p_before: before });
export const closeOldRequests = (before: string) => rpc<number>('close_old_requests', { p_before: before });

/** Номер для показа: простой номер ручной заявки — «№ 12», номер ITSM — как есть. */
export function requestLabel(number: string | null | undefined): string {
  if (!number) return '';
  return /^\d+$/.test(number) ? `№ ${number}` : number;
}

// ---------- Ручные заявки ----------
export const createManualRequest = (title: string, details: string | null, assigneeId: number | null) =>
  rpc<{ id: number; number: string }>('create_manual_request', { p_title: title, p_details: details, p_assignee: assigneeId });

/** «2026-10-09 14:05:00» → «09.10.2026 14:05». */
export function formatRegistered(ts: string | null | undefined): string {
  if (!ts) return '—';
  const [d, t] = ts.replace('T', ' ').split(' ');
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}${t ? ' ' + t.slice(0, 5) : ''}`;
}

/** Срок ITSM (местное время магазина, «ГГГГ-ММ-ДД ЧЧ:ММ:СС») → текст и признак «просрочена». */
export function dueState(dueAt: string | null | undefined): { text: string; overdue: boolean } | null {
  if (!dueAt) return null;
  const local = dueAt.replace('T', ' ').slice(0, 19);
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  return { text: formatRegistered(local), overdue: local < now };
}

/** Отметка времени базы (UTC) → «09.10.2026 14:05» по Тюмени (UTC+5). */
export function formatStoreTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000).toISOString();
  return formatRegistered(`${d.slice(0, 10)} ${d.slice(11, 16)}`);
}
