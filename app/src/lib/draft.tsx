import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import type { MyEntry } from './shift';
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
};

export type Draft = {
  clientUuid: string;
  workDate: string;
  /** Правка уже отправленной смены. */
  editing: boolean;
  entries: DraftEntry[];
  /** Заявка, к которой сейчас добавляются работы: строка, null — «без заявки», undefined — не выбрана. */
  currentRequest?: string | null;
};

type DraftState = {
  ready: boolean;
  draft: Draft | null;
  start: (workDate: string) => void;
  startEdit: (entries: MyEntry[]) => void;
  setRequest: (request: string | null) => void;
  setWorkDate: (workDate: string) => void;
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

  const start = useCallback((workDate: string) => {
    setDraft({ clientUuid: uuid(), workDate, editing: false, entries: [] });
  }, []);

  const startEdit = useCallback((rows: MyEntry[]) => {
    const first = rows[0];
    if (!first?.client_uuid) return;
    setDraft({
      clientUuid: first.client_uuid,
      workDate: first.work_date,
      editing: true,
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
      return { ...d, entries };
    });
  }, []);

  const removeEntry = useCallback((key: string) => {
    setDraft((d) => (d ? { ...d, entries: d.entries.filter((e) => e.key !== key) } : d));
  }, []);

  const clear = useCallback(() => setDraft(null), []);

  const value = useMemo(
    () => ({ ready, draft, start, startEdit, setRequest, setWorkDate, upsertEntry, removeEntry, clear }),
    [ready, draft, start, startEdit, setRequest, setWorkDate, upsertEntry, removeEntry, clear],
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
