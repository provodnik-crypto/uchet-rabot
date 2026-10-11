import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Фото сотрудников лежат в закрытом хранилище; ссылки временные, поэтому кешируем их на час. */
const LIFETIME_S = 3600;
let cache: { at: number; urls: Record<number, string> } | null = null;
let pending: Promise<Record<number, string>> | null = null;

async function loadPhotoUrls(): Promise<Record<number, string>> {
  const { data, error } = await supabase.from('employees').select('id, photo_path').not('photo_path', 'is', null);
  if (error || !data?.length) return {};
  const paths = data.map((e) => e.photo_path as string);
  const { data: signed } = await supabase.storage.from('employee-photos').createSignedUrls(paths, LIFETIME_S);
  const urls: Record<number, string> = {};
  data.forEach((e, i) => {
    const url = signed?.[i]?.signedUrl;
    if (url) urls[e.id] = url;
  });
  return urls;
}

export function getPhotoUrls(): Promise<Record<number, string>> {
  if (cache && Date.now() - cache.at < (LIFETIME_S - 300) * 1000) return Promise.resolve(cache.urls);
  pending ??= loadPhotoUrls()
    .then((urls) => {
      cache = { at: Date.now(), urls };
      return urls;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Ссылки на фото: id сотрудника → адрес картинки. Пока грузятся — пустой объект (покажутся инициалы). */
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
