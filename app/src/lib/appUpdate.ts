import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isConfigured, supabase } from './supabase';

/**
 * Обновления приложения. По умолчанию Expo применяет скачанное обновление только при полном
 * перезапуске, а Android часто держит приложение в памяти — и старая версия живёт днями.
 * Поэтому проверяем сами при каждом открытии и предлагаем кнопку «Обновить».
 */
export function useAppUpdate() {
  const [ready, setReady] = useState(false);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (!Updates.isEnabled || checking.current) return;
    checking.current = true;
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew) setReady(true);
      }
    } catch {
      // нет связи — проверим при следующем открытии
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const apply = useCallback(() => {
    Updates.reloadAsync().catch(() => {});
  }, []);

  return { ready, apply };
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
