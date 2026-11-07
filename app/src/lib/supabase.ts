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

/** Один запрос с пределом ожидания; отмена со стороны вызывающего тоже работает. */
function fetchOnce(input: RequestInfo | URL, init?: RequestInit, limitMs?: number): Promise<Response> {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const upload = href.includes('/storage/v1/') && method !== 'GET';
  const ms = limitMs ?? (upload ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
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
      // Только текстовые ответы (JSON) и только как текст: так буквы остаются в UTF-8.
      // (Чтение байтами ломало русские буквы на Android — 22.10.2026.) Прочие ответы — как есть.
      const type = res.headers.get('content-type') ?? '';
      const empty = res.status === 204 || res.status === 205 || res.status === 304 || method === 'HEAD';
      if (empty || !/json|text/i.test(type)) return res;
      const text = await res.text();
      return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    })
    .catch((e) => {
      throw timedOut ? new TimeoutError() : e;
    })
    .finally(() => clearTimeout(timer));
}

/**
 * Посредник в России (Яндекс Облако): телефоны ходят на его адрес, он — на основной сервер. Так провайдер
 * не «теряет» адрес сервера и не тормозит соединение. Адрес задаётся при обновлении (EXPO_PUBLIC_PROXY_URL);
 * пустой — посредника нет, всё как раньше. Посредник проверяется при запуске и раз в 5 минут; не ответил —
 * приложение само работает напрямую.
 */
const proxyBase = (process.env.EXPO_PUBLIC_PROXY_URL ?? '').replace(/\/+$/, '');
let useProxy = false;
let lastCheck = 0;
const RECHECK_MS = 5 * 60_000;

async function checkProxy() {
  if (!proxyBase || !url || !anonKey) return;
  lastCheck = Date.now();
  try {
    const res = await fetchOnce(`${proxyBase}/auth/v1/health`, { headers: { apikey: anonKey } }, 8_000);
    useProxy = res.ok;
  } catch {
    useProxy = false;
  }
}
if (proxyBase) void checkProxy();

/** Адрес, через который сейчас идут запросы (для ссылок на фото). */
export function serverBase(): string {
  return useProxy && proxyBase ? proxyBase : url ?? '';
}
/** Ссылка основного сервера → через посредника, если он сейчас работает. */
export function viaServerBase(link: string): string {
  return url && useProxy && proxyBase && link.startsWith(url) ? proxyBase + link.slice(url.length) : link;
}

/** fetch с пределом ожидания; через посредника, если он работает, иначе напрямую. */
export const fetchWithTimeout: typeof fetch = async (input, init) => {
  if (proxyBase && !useProxy && Date.now() - lastCheck > RECHECK_MS) void checkProxy();
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
  if (!useProxy || !href || !url || !href.startsWith(url)) return fetchOnce(input, init);
  const method = (init?.method ?? 'GET').toUpperCase();
  const safe = method === 'GET' || method === 'HEAD';
  try {
    const res = await fetchOnce(proxyBase + href.slice(url.length), init);
    // посредник не достучался до сервера — дальше напрямую
    if (res.status === 502 || res.status === 504) {
      useProxy = false;
      lastCheck = Date.now();
      return safe ? fetchOnce(input, init) : res;
    }
    return res;
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    useProxy = false;
    lastCheck = Date.now();
    // изменяющий запрос, на который не дождались ответа, мог уже выполниться — не повторяем, сообщаем об ошибке
    if (e instanceof TimeoutError && !safe) throw e;
    return fetchOnce(input, init);
  }
};

/**
 * Имя, под которым на телефоне хранится вход. По умолчанию оно зависит от адреса сервера —
 * при переезде на другой сервер все бы вышли из приложения. Поэтому имя постоянное (прежнее).
 */
const SESSION_STORAGE_KEY = 'sb-lslqcrcxpvavqqrnayde-auth-token';

export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: {
    // Сессия хранится на устройстве: мастер не вводит пароль каждую смену.
    storage: Platform.OS === 'web' && typeof window === 'undefined' ? undefined : AsyncStorage,
    storageKey: SESSION_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
});

/** Кто выдал вход: поле iss в токене (адрес сервера + /auth/v1). */
function tokenIssuer(token: string): string | null {
  try {
    const part = token.split('.')[1] ?? '';
    const json = globalThis.atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const iss = (JSON.parse(json) as { iss?: unknown }).iss;
    return typeof iss === 'string' ? iss : null;
  } catch {
    return null;
  }
}

let adopting: Promise<void> | null = null;
/**
 * Переезд сервера: вход, выданный прежним сервером, один раз продлевается на новом — без пароля
 * (сотрудники и их входы перенесены вместе с базой). Не вышло из-за связи — повторится при следующем
 * открытии приложения; новый сервер не принял вход — выходим, сотрудник входит своим паролем.
 */
export function adoptServer(): Promise<void> {
  if (!url || !isConfigured) return Promise.resolve();
  adopting ??= (async () => {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s) return;
    const iss = tokenIssuer(s.access_token);
    if (!iss || iss.startsWith(url.replace(/\/+$/, ''))) return;
    const { error } = await supabase.auth.refreshSession();
    // выходим только если сервер ответил «такого входа нет / недействителен» (не при перегрузке или сбое связи)
    if (error && error.name === 'AuthApiError' && [400, 401, 403, 404].includes(error.status ?? 0)) {
      await supabase.auth.signOut({ scope: 'local' });
    }
  })()
    .catch(() => {})
    .finally(() => {
      adopting = null;
    });
  return adopting;
}

// Обновлять токен, только пока приложение на экране.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
      void adoptServer();
    } else supabase.auth.stopAutoRefresh();
  });
}
