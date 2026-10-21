import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

/** Сколько ждать ответа сервера. Без предела повисший запрос (плохой Wi-Fi) крутит загрузку бесконечно. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** Загрузка фото и файлов на медленной связи идёт дольше. */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Ошибка «сервер не ответил вовремя» — по ней errors.ts показывает понятный текст. */
export class TimeoutError extends Error {
  constructor() {
    super('Timeout: server did not respond');
    this.name = 'TimeoutError';
  }
}

/** fetch с пределом ожидания; отмена со стороны вызывающего тоже работает. */
export const fetchWithTimeout: typeof fetch = (input, init) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const upload = href.includes('/storage/v1/') && method !== 'GET';
  const ms = upload ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', () => ctrl.abort());
  }
  return fetch(input, { ...init, signal: ctrl.signal })
    .then(async (res) => {
      // Ответ читаем целиком в пределах того же ожидания: при обрыве связи посреди ответа
      // будет ошибка связи (с «Повторить»), а не пустые данные без ошибки.
      const empty = res.status === 204 || res.status === 205 || res.status === 304 || method === 'HEAD';
      const body = empty ? null : await res.arrayBuffer();
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    })
    .catch((e) => {
      throw timedOut ? new TimeoutError() : e;
    })
    .finally(() => clearTimeout(timer));
};

export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: {
    // Сессия хранится на устройстве: мастер не вводит пароль каждую смену.
    storage: Platform.OS === 'web' && typeof window === 'undefined' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
});

// Обновлять токен, только пока приложение на экране.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
