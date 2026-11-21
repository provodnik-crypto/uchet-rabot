import { supabase } from './supabase';
import type { LifecycleStatus } from './requests';

/** Этап «Инициаторы»: заявки из магазина, минуя ITSM. RPC на сервере — 20261121000002_initiators.sql. */

/** «Что сделать» — те же виды, что в старом бумажном шаблоне; список дублирует база (create_initiator_request). */
export const WORK_CATEGORIES = ['Демонтаж', 'Замена', 'Ремонт', 'Оклейка', 'Размещение', 'Покраска', 'Сборка', 'Другое'] as const;
export type WorkCategory = (typeof WORK_CATEGORIES)[number];

/** Строка списка «Мои заявки» / «Заявки отдела» (самая старая сверху — порядок отдаёт сервер). */
export type InitiatorRequest = {
  id: number;
  number: string;
  subject: string;
  operation: string;
  status: LifecycleStatus;
  priority: number;
  place: string | null;
  due_date: string | null;
  materials: string | null;
  urgent_reason: string | null;
  created_at: string;
  creator_name: string;
  master_name: string | null;
  department_name: string | null;
  can_cancel: boolean;
};

export type InitiatorCard = Omit<InitiatorRequest, 'created_at' | 'due_date'> & {
  registered_at: string;
  due_at: string | null;
  photos: { path: string; thumb_path: string }[];
};

export type InitiatorProfileInfo = {
  id: number;
  display_name: string;
  grade: number | null;
  department_id: number | null;
  department_name: string | null;
  work_phone: string | null;
  mobile: string | null;
};

export async function initiatorRequests(scope: 'my' | 'department'): Promise<InitiatorRequest[]> {
  const { data, error } = await supabase.rpc('initiator_requests', { p_scope: scope });
  if (error) throw error;
  return (data ?? []) as InitiatorRequest[];
}

export async function initiatorRequestCard(id: number): Promise<InitiatorCard | null> {
  const { data, error } = await supabase.rpc('initiator_request_card', { p_id: id });
  if (error) throw error;
  return (data ?? null) as InitiatorCard | null;
}

export type NewInitiatorRequest = {
  category: string;
  description: string;
  departmentId: number;
  place: string;
  /** «К дате»: YYYY-MM-DD; для «Планово» и «Срочно» — null. */
  due?: string | null;
  urgent?: boolean;
  urgentReason?: string | null;
  materials?: string | null;
  /** Уже загруженные в storage фото (uploadPhotos + toPayload из lib/workPhotos). */
  photos: Array<{ path?: string; thumb_path?: string }>;
};

export async function createInitiatorRequest(input: NewInitiatorRequest): Promise<{ id: number; number: string }> {
  const { data, error } = await supabase.rpc('create_initiator_request', {
    p_category: input.category,
    p_description: input.description,
    p_department_id: input.departmentId,
    p_place: input.place,
    p_due: input.urgent ? null : (input.due ?? null),
    p_urgent: input.urgent ?? false,
    p_urgent_reason: input.urgent ? (input.urgentReason ?? null) : null,
    p_materials: input.materials ?? null,
    p_photos: input.photos,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row.id, number: row.number };
}

export async function cancelInitiatorRequest(id: number): Promise<void> {
  const { error } = await supabase.rpc('cancel_initiator_request', { p_id: id });
  if (error) throw error;
}

export async function initiatorProfile(): Promise<InitiatorProfileInfo> {
  const { data, error } = await supabase.rpc('initiator_profile');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as InitiatorProfileInfo;
}

export async function setMyDepartment(departmentId: number): Promise<void> {
  const { error } = await supabase.rpc('set_my_department', { p_department_id: departmentId });
  if (error) throw error;
}

/** Создать отдел или вернуть существующий с таким же названием (без различия регистра/пробелов). */
export async function addDepartmentByName(name: string): Promise<number> {
  const { data, error } = await supabase.rpc('add_department', { p_name: name });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as number;
}

export async function setMyMobile(mobile: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_my_mobile', { p_mobile: mobile });
  if (error) throw error;
}
