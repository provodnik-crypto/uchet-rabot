import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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
