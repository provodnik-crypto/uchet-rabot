import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isConfigured, supabase } from './supabase';

/** Сколько ждать новое обновление при запуске, прежде чем открыть приложение как есть. */
const STARTUP_WAIT_MS = 5000;
/** После такого перерыва (приложение было свёрнуто) обновление ставится сразу при возвращении. */
const RESUME_AFTER_MS = 10 * 60 * 1000;

async function fetchNew(): Promise<boolean> {
  const res = await Updates.checkForUpdateAsync();
  if (!res.isAvailable) return false;
  const fetched = await Updates.fetchUpdateAsync();
  return fetched.isNew;
}

/**
 * Обновления «по воздуху» ставятся сами, без кнопок:
 * * при запуске ждём новое обновление до 5 секунд — успело скачаться, приложение сразу перезапускается новым;
 *   не успело — докачается и включится при следующем открытии;
 * * Android держит приложение в памяти днями — если оно было свёрнуто дольше 10 минут, при возвращении
 *   проверяем ещё раз и ставим новое сразу.
 * Новая сборка APK нужна только при смене иконки, разрешений или нативных модулей (полоса «Вышла новая сборка»).
 */
export function useAppUpdate() {
  const [starting, setStarting] = useState(Updates.isEnabled);
  const busy = useRef(false);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    let alive = true;
    const timer = setTimeout(() => alive && setStarting(false), STARTUP_WAIT_MS);
    busy.current = true;
    fetchNew()
      .then((isNew) => {
        if (isNew && alive) return Updates.reloadAsync();
      })
      .catch(() => {})
      .finally(() => {
        busy.current = false;
        if (alive) setStarting(false);
        clearTimeout(timer);
      });
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') {
        hiddenAt.current ??= Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (away < RESUME_AFTER_MS || busy.current) return;
      busy.current = true;
      fetchNew()
        .then((isNew) => (isNew ? Updates.reloadAsync() : undefined))
        .catch(() => {})
        .finally(() => {
          busy.current = false;
        });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return { starting };
}

/** Дата текущей версии для подписи «Версия от …». */
export function appVersionLabel(): string {
  const d = Updates.createdAt;
  if (!Updates.isEnabled || !d) return 'версия разработки';
  const p = (n: number) => String(n).padStart(2, '0');
  return `версия от ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Обновления «по воздуху» приходят только на сборку с той же версией среды (runtimeVersion).
 * Если вышла новая сборка APK, старая молча перестаёт обновляться — поэтому сверяемся с базой
 * и показываем ссылку на новый APK. Строку в таблице app_release обновляют после каждой сборки.
 */
export function useApkRelease() {
  const [apkUrl, setApkUrl] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!Updates.isEnabled || !isConfigured) return;
    try {
      const { data } = await supabase.from('app_release').select('runtime_version, apk_url').eq('platform', 'android').maybeSingle();
      setApkUrl(data && isOlder(Updates.runtimeVersion, data.runtime_version) ? data.apk_url : null);
    } catch {
      // нет связи — проверим при следующем открытии
    }
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  return apkUrl;
}

/** «2» старше «3»; первые сборки имели версию вида «exposdk:57.0.0» — они старше любой числовой. */
export function isOlder(mine: string | null | undefined, latest: string): boolean {
  const l = Number(latest);
  if (!mine || !Number.isFinite(l)) return false;
  const m = Number(mine);
  return !Number.isFinite(m) || m < l;
}
