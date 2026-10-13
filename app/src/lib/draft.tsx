import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import type { RequestStatus } from './requestTime';
import type { MyEntry, OpenRequest } from './shift';
import { remoteToDraft, type DraftPhoto, type RemotePhoto } from './workPhotos';
import { uuid } from './today';

/** Работа в черновике смены. Хранится на телефоне до успешной отправки. */
export type DraftEntry = {
  key: string;
  requestNumber: string | null;
  departmentId: number;
  departmentName: string;
  priceItemId: number | null;
  customName: string | null;
  name: string;
  category: string | null;
  unitId: number;
  unitCode: string;
  integerOnly: boolean;
  quantity: string;
  note: string;
  performerIds: number[];
  performerNames: string[];
  /** Фото работы (до 3). Загружаются при отправке смены. */
  photos?: DraftPhoto[];
};

/** Время и статус по заявке в этой смене. number null — работы без заявки. */
export type DraftRequest = {
  number: string | null;
  /** Минуты за эту смену; null — ещё не указано. */
  minutes: number | null;
  status: RequestStatus;
  /** Заявка перенесена с прошлых смен (не закончена). */
  carried?: { since: string; spent: number; entries: number; plan: number | null };
};

export type Draft = {
  clientUuid: string;
  workDate: string;
  /** Правка уже отправленной смены. */
  editing: boolean;
  entries: DraftEntry[];
  /** Время и статусы по заявкам, в порядке показа (перенесённые — первыми). В старых черновиках поля нет. */
  requests?: DraftRequest[];
  /** Заявка, к которой сейчас добавляются работы: строка, null — «без заявки», undefined — не выбрана. */
  currentRequest?: string | null;
};

type DraftState = {
  ready: boolean;
  draft: Draft | null;
  start: (workDate: string, carried?: OpenRequest[]) => void;
  startEdit: (entries: MyEntry[], photos?: Record<number, RemotePhoto[]>, requests?: DraftRequest[]) => void;
  setRequestTime: (number: string | null, patch: Partial<Pick<DraftRequest, 'minutes' | 'status'>>) => void;
  setRequest: (request: string | null) => void;
  setWorkDate: (workDate: string) => void;
  /** Черновик отправлен, но день продолжается: дальнейшие правки отправятся заменой той же смены. */
  markSent: () => void;
  upsertEntry: (entry: DraftEntry) => void;
  removeEntry: (key: string) => void;
  clear: () => void;
};

const DraftContext = createContext<DraftState | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const storageKey = me ? `shift-draft-v1:${me.id}` : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ready, setReady] = useState(false);
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    setReady(false);
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!cancelled) setDraft(raw ? (JSON.parse(raw) as Draft) : null);
      })
      .catch(() => {
        if (!cancelled) setDraft(null);
      })
      .finally(() => {
        if (!cancelled) {
          loadedKey.current = storageKey;
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Каждое изменение сразу сохраняется на телефон: смена не теряется при обрыве связи или закрытии приложения.
  useEffect(() => {
    if (!storageKey || loadedKey.current !== storageKey) return;
    if (draft) AsyncStorage.setItem(storageKey, JSON.stringify(draft)).catch(() => {});
    else AsyncStorage.removeItem(storageKey).catch(() => {});
  }, [draft, storageKey]);

  const start = useCallback((workDate: string, carried: OpenRequest[] = []) => {
    setDraft({
      clientUuid: uuid(),
      workDate,
      editing: false,
      entries: [],
      requests: carried.map((r) => ({
        number: r.number,
        minutes: null,
        status: 'done',
        carried: { since: r.since, spent: r.spent_minutes, entries: r.entries, plan: r.plan_minutes },
      })),
    });
  }, []);

  const startEdit = useCallback((rows: MyEntry[], photos: Record<number, RemotePhoto[]> = {}, requests: DraftRequest[] = []) => {
    const first = rows[0];
    if (!first?.client_uuid) return;
    setDraft({
      clientUuid: first.client_uuid,
      workDate: first.work_date,
      editing: true,
      requests,
      entries: rows
        .slice()
        .sort((a, b) => a.entry_position - b.entry_position)
        .map((r) => ({
          key: uuid(),
          requestNumber: r.request_number,
          departmentId: r.department_id,
          departmentName: r.department_name,
          priceItemId: r.price_item_id,
          customName: r.is_custom ? r.name : null,
          name: r.name,
          category: r.category,
          unitId: r.unit_id,
          unitCode: r.unit_code,
          integerOnly: r.integer_only,
          quantity: String(Number(r.quantity)).replace('.', ','),
          note: r.note ?? '',
          performerIds: r.performer_ids,
          performerNames: r.performer_names.split(', '),
          photos: remoteToDraft(photos[r.entry_id]),
        })),
    });
  }, []);

  const setRequest = useCallback((request: string | null) => {
    setDraft((d) => (d ? { ...d, currentRequest: request } : d));
  }, []);

  const setWorkDate = useCallback((workDate: string) => {
    setDraft((d) => (d ? { ...d, workDate } : d));
  }, []);

  const upsertEntry = useCallback((entry: DraftEntry) => {
    setDraft((d) => {
      if (!d) return d;
      const i = d.entries.findIndex((e) => e.key === entry.key);
      const entries = i >= 0 ? d.entries.map((e) => (e.key === entry.key ? entry : e)) : [...d.entries, entry];
      return tidyRequests({ ...d, entries });
    });
  }, []);

  const removeEntry = useCallback((key: string) => {
    setDraft((d) => (d ? tidyRequests({ ...d, entries: d.entries.filter((e) => e.key !== key) }) : d));
  }, []);

  const setRequestTime = useCallback((number: string | null, patch: Partial<Pick<DraftRequest, 'minutes' | 'status'>>) => {
    setDraft((d) => {
      if (!d) return d;
      const list = requestList(d);
      const i = list.findIndex((r) => r.number === number);
      const next = i >= 0 ? list.map((r, j) => (j === i ? { ...r, ...patch } : r)) : [...list, { number, minutes: null, status: 'done' as const, ...patch }];
      return { ...d, requests: next };
    });
  }, []);

  const markSent = useCallback(() => setDraft((d) => (d ? { ...d, editing: true } : d)), []);

  const clear = useCallback(() => setDraft(null), []);

  const value = useMemo(
    () => ({ ready, draft, start, startEdit, setRequestTime, setRequest, setWorkDate, markSent, upsertEntry, removeEntry, clear }),
    [ready, draft, start, startEdit, setRequestTime, setRequest, setWorkDate, markSent, upsertEntry, removeEntry, clear],
  );
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftState {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('useDraft вне DraftProvider');
  return ctx;
}

/** Работы черновика по заявкам, в порядке появления заявок. */
export function groupByRequest(entries: DraftEntry[]): { request: string | null; entries: DraftEntry[] }[] {
  const groups: { request: string | null; entries: DraftEntry[] }[] = [];
  for (const e of entries) {
    let g = groups.find((x) => x.request === e.requestNumber);
    if (!g) {
      g = { request: e.requestNumber, entries: [] };
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}

/**
 * Заявки смены по порядку: сначала из списка времени (перенесённые — первыми), затем те, по которым
 * есть работы, но время ещё не трогали. Работает и со старыми черновиками без поля requests.
 */
export function requestList(d: Draft): DraftRequest[] {
  const list = [...(d.requests ?? [])];
  for (const e of d.entries) {
    if (!list.some((r) => r.number === e.requestNumber)) list.push({ number: e.requestNumber, minutes: null, status: 'done' });
  }
  return list;
}

/** Заявка без работ и без времени убирается из смены, если она не перенесённая. */
function tidyRequests(d: Draft): Draft {
  const requests = requestList(d).filter((r) => r.carried || r.minutes || d.entries.some((e) => e.requestNumber === r.number));
  return { ...d, requests };
}

export type ShiftGroup = { request: string | null; entries: DraftEntry[]; time: DraftRequest };

/** Группы смены для экранов: заявка, её работы, время и статус. */
export function shiftGroups(d: Draft): ShiftGroup[] {
  return requestList(d).map((time) => ({ request: time.number, entries: d.entries.filter((e) => e.requestNumber === time.number), time }));
}

/** Группа уходит на сервер, если в ней есть работы или указано время. */
export const groupIsSent = (g: ShiftGroup) => g.entries.length > 0 || (g.time.minutes ?? 0) > 0;
