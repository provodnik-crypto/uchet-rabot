import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { sanitize } from './errorText';
import { supabase } from './supabase';

/**
 * Журнал ошибок на устройствах (таблица app_errors). Без личных данных: экран, время, вид и текст
 * ошибки, версия приложения, роль и случайный номер телефона-установки. Ошибки без связи копятся
 * на телефоне и уходят на сервер при следующей удачной возможности.
 */
type Item = {
  at: string;
  screen: string;
  kind: string;
  message: string;
  code: string;
  app_version: string;
  runtime_version: string;
  os: string;
  device: string;
};

const QUEUE_KEY = 'errlog:queue';
const DEVICE_KEY = 'errlog:device';
const MAX_QUEUE = 50;

let currentScreen = '';
let queue: Item[] | null = null;
let device = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
const recent = new Map<string, number>();

/** Текущий экран (путь вида /requests/12) — ставит корневой макет. */
export function setCurrentScreen(path: string) {
  currentScreen = path;
}

function appVersion(): string {
  const d = Updates.createdAt;
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : 'встроенная';
  return d ? `${d.toISOString().slice(0, 16)} ${id}` : id;
}

async function loadQueue(): Promise<Item[]> {
  if (queue) return queue;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    queue = raw ? (JSON.parse(raw) as Item[]) : [];
  } catch {
    queue = [];
  }
  try {
    device = (await AsyncStorage.getItem(DEVICE_KEY)) ?? '';
    if (!device) {
      device = Math.random().toString(36).slice(2, 10);
      await AsyncStorage.setItem(DEVICE_KEY, device);
    }
  } catch {
    device = device || 'unknown';
  }
  return queue;
}

function save() {
  AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue ?? [])).catch(() => {});
}

/** Записать сбой в журнал. Одинаковые ошибки на одном экране чаще раза в 10 секунд не пишутся. */
export function reportError(e: unknown, kind: string, screen?: string) {
  try {
    const raw = e instanceof Error ? `${e.name}: ${e.message}` : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
    const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code ?? '') : '';
    const where = screen ?? currentScreen ?? '';
    const message = sanitize(raw);
    const sig = `${where}|${kind}|${message}`;
    const now = Date.now();
    if ((recent.get(sig) ?? 0) > now - 10_000) return;
    recent.set(sig, now);
    loadQueue().then((q) => {
      q.push({
        at: new Date().toISOString(),
        screen: where.slice(0, 120),
        kind,
        message,
        code: code.slice(0, 20),
        app_version: appVersion(),
        runtime_version: String(Updates.runtimeVersion ?? ''),
        os: `${Platform.OS} ${Platform.Version}`,
        device,
      });
      if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
      save();
      scheduleFlush(3000);
    });
  } catch {
    // журнал не должен ронять приложение
  }
}

function scheduleFlush(ms: number) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushErrors();
  }, ms);
}

/** Отправить накопленное. Вызывается после ошибок и при каждой удачной загрузке экрана. */
export async function flushErrors() {
  if (flushing) return;
  const q = await loadQueue();
  if (!q.length) return;
  flushing = true;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const batch = q.slice(0, 20);
    const { error } = await supabase.rpc('log_app_errors', { p_items: batch });
    if (error) return; // нет связи или идёт обновление — попробуем позже
    q.splice(0, batch.length);
    save();
    if (q.length) scheduleFlush(1000);
  } catch {
    // попробуем при следующей загрузке
  } finally {
    flushing = false;
  }
}

/** Необработанные ошибки JavaScript (то, что раньше закрывало экран) — тоже в журнал. */
let crashInstalled = false;
export function installCrashLog() {
  if (crashInstalled) return;
  crashInstalled = true;
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
  };
  const eu = g.ErrorUtils;
  if (!eu) return;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((e, fatal) => {
    reportError(e, fatal ? 'crash' : 'js');
    prev(e, fatal);
  });
}
