import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Фото сотрудников — маленькие картинки прямо в записи сотрудника (data:image/jpeg;base64).
 * Приходят вместе с данными, без отдельной загрузки из хранилища. Кешируем на 10 минут.
 */
const LIFETIME_MS = 10 * 60 * 1000;
let cache: { at: number; urls: Record<number, string> } | null = null;
let pending: Promise<Record<number, string>> | null = null;

async function loadPhotos(): Promise<Record<number, string>> {
  const { data, error } = await supabase.from('employees').select('id, photo_thumb').not('photo_thumb', 'is', null);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((e) => [e.id, e.photo_thumb as string]));
}

export function getPhotoUrls(): Promise<Record<number, string>> {
  if (cache && Date.now() - cache.at < LIFETIME_MS) return Promise.resolve(cache.urls);
  pending ??= loadPhotos()
    .then((urls) => {
      cache = { at: Date.now(), urls };
      return urls;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** id сотрудника → картинка. Пока грузится — пустой объект (видны инициалы). */
export function usePhotoUrls(): Record<number, string> {
  const [urls, setUrls] = useState<Record<number, string>>(cache?.urls ?? {});
  useEffect(() => {
    let alive = true;
    getPhotoUrls()
      .then((u) => alive && setUrls(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return urls;
}
