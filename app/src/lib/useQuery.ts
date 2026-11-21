import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushErrors } from './errorLog';
import { errorKind, humanError } from './errors';

/**
 * Последние загруженные данные экранов. В памяти — пока приложение открыто, на телефоне — между
 * запусками (только для запросов с ключом). Всё привязано к вошедшему пользователю и стирается при выходе.
 */
type Entry = { data: unknown; at: number };
const memory = new Map<string, Entry>();
let scope = '';
const PREFIX = 'qc:';
/** Большие ответы на телефоне не храним. */
const MAX_SAVED_CHARS = 300_000;

/** Вызывается при входе: данные другого пользователя на этом телефоне не покажутся. */
export function setQueryCacheUser(userId: number | null) {
  const next = userId == null ? '' : String(userId);
  if (next !== scope) memory.clear();
  scope = next;
}

/** Стирает запомненные данные (при выходе из учётной записи). */
export async function clearQueryCache() {
  memory.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
  } catch {
    // не страшно: при следующем входе ключи привязаны к пользователю
  }
}

const fullKey = (key: string) => `${PREFIX}${scope}:${key}`;

export type QueryState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Когда данные на экране были получены с сервера (null — ещё ни разу). */
  updatedAt: Date | null;
  reload: () => Promise<void>;
};

type Options = {
  /**
   * Имя запроса вместе с параметрами (например `summary:2026-10-01:2026-10-20`). Смена ключа —
   * новая загрузка; данные с тем же ключом показываются сразу, пока грузятся свежие.
   */
  key?: string;
  /** Хранить на телефоне между запусками (по умолчанию да, если задан ключ). */
  persist?: boolean;
  /** Пауза перед загрузкой после смены ключа (поиск по мере ввода), мс. */
  debounceMs?: number;
};

/** Загружает данные при каждом открытии экрана; хранит ошибку для кнопки «Повторить». */
export function useFocusQuery<T>(load: () => Promise<T>, opts: Options = {}): QueryState<T> {
  const { key, persist = !!key, debounceMs = 0 } = opts;
  const cached = key ? memory.get(fullKey(key)) : undefined;
  const [data, setData] = useState<T | null>((cached?.data as T) ?? null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(cached ? new Date(cached.at) : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(key);
  keyRef.current = key;
  const seq = useRef(0);
  const hasData = useRef(!!cached);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    const k = keyRef.current;
    setLoading(true);
    setError(null);
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await loadRef.current();
        if (my !== seq.current) return;
        const at = Date.now();
        setData(result);
        setUpdatedAt(new Date(at));
        hasData.current = true;
        setLoading(false);
        if (k) {
          memory.set(fullKey(k), { data: result, at });
          if (persist && scope) {
            const text = JSON.stringify({ data: result, at });
            if (text.length <= MAX_SAVED_CHARS) AsyncStorage.setItem(fullKey(k), text).catch(() => {});
          }
        }
        flushErrors();
        return;
      } catch (e) {
        if (my !== seq.current) return;
        const kind = errorKind(e);
        // Обрыв связи или обновление сервера часто проходят за секунды — один раз пробуем сами.
        if (attempt === 0 && (kind === 'network' || kind === 'updating')) {
          await new Promise((r) => setTimeout(r, 2000));
          if (my !== seq.current) return;
          continue;
        }
        setError(humanError(e));
        setLoading(false);
        return;
      }
    }
  }, [persist]);

  // Смена ключа: показать запомненное для нового ключа (или ничего) и загрузить свежее.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
    } else {
      const c = key ? memory.get(fullKey(key)) : undefined;
      setData((c?.data as T) ?? null);
      setUpdatedAt(c ? new Date(c.at) : null);
      hasData.current = !!c;
      const t = setTimeout(reload, debounceMs);
      return () => clearTimeout(t);
    }
  }, [key, debounceMs, reload]);

  // Данные с прошлого запуска: подставляем, если свежие ещё не пришли.
  useEffect(() => {
    if (!key || !persist || !scope || hasData.current) return;
    const k = fullKey(key);
    let alive = true;
    AsyncStorage.getItem(k)
      .then((raw) => {
        if (!alive || !raw || hasData.current || keyRef.current !== key) return;
        const saved = JSON.parse(raw) as Entry;
        if (!memory.has(k)) memory.set(k, saved);
        setData(saved.data as T);
        setUpdatedAt(new Date(saved.at));
        hasData.current = true;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, persist]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { data, error, loading, updatedAt, reload };
}

/** «19:20» сегодня или «19.10 19:20» в другой день — по часам телефона. */
export function formatUpdatedAt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? time : `${p(d.getDate())}.${p(d.getMonth() + 1)} ${time}`;
}
