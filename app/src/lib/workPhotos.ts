import { Alert, Linking, Platform } from 'react-native';
import { supabase, viaServerBase } from './supabase';
import { uuid } from './today';

/** Фото работы в черновике: снятое на телефоне (localUri) и/или уже загруженное (path). */
export type DraftPhoto = {
  key: string;
  localUri?: string;
  thumbUri?: string;
  path?: string;
  thumbPath?: string;
  width?: number;
  height?: number;
  size?: number;
};

/** Фото работы на сервере. */
export type RemotePhoto = { entry_id: number; photo_position: number; path: string; thumb_path: string };

export const MAX_PHOTOS = 3;
const BUCKET = 'work-photos';
const LONG_SIDE = 1600;
const THUMB_SIDE = 320;
const TARGET_BYTES = 420 * 1024;

// ---------- Разрешения: спрашиваем только при нажатии, с объяснением ----------
function ask(title: string, message: string, ok: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(true);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Не сейчас', style: 'cancel', onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ]),
  );
}

function deniedForever(what: string) {
  Alert.alert(
    `Доступ к ${what} выключен`,
    `Без него фото добавить нельзя, остальное работает как обычно. Включить: Настройки телефона → Приложения → «Учёт работ» → Разрешения.`,
    [
      { text: 'Понятно', style: 'cancel' },
      { text: 'Открыть настройки', onPress: () => Linking.openSettings().catch(() => {}) },
    ],
  );
}

/** Снять камерой или выбрать из галереи. null — если мастер передумал или не дал доступ. */
export async function pickPhoto(source: 'camera' | 'library'): Promise<DraftPhoto | null> {
  const ImagePicker = await import('expo-image-picker');
  if (source === 'camera') {
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (!current.granted) {
      if (!current.canAskAgain) {
        deniedForever('камере');
        return null;
      }
      const go = await ask(
        'Доступ к камере',
        'Чтобы сфотографировать выполненную работу, приложению нужен доступ к камере. Фото увидят только руководитель и исполнители работы.',
        'Разрешить',
      );
      if (!go) return null;
      const res = await ImagePicker.requestCameraPermissionsAsync();
      if (!res.granted) {
        if (!res.canAskAgain) deniedForever('камере');
        return null;
      }
    }
  }
  const options = { mediaTypes: ['images'] as ImagePickerMediaTypes, quality: 1, exif: false, allowsEditing: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  return preparePhoto(a.uri, a.width, a.height);
}
type ImagePickerMediaTypes = import('expo-image-picker').MediaType[];

/**
 * Сжатие на телефоне: длинная сторона до 1600 px, JPEG ~300–400 КБ, плюс миниатюра 320 px.
 * Файл пересохраняется заново, поэтому геометка и прочие данные EXIF в него не попадают.
 */
async function preparePhoto(uri: string, width: number, height: number): Promise<DraftPhoto> {
  const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
  const resize = (side: number) =>
    Math.max(width, height) > side ? [width >= height ? { resize: { width: side } } : { resize: { height: side } }] : [];
  let main = await manipulateAsync(uri, resize(LONG_SIDE), { compress: 0.72, format: SaveFormat.JPEG });
  let size = await fileSize(main.uri);
  if (size && size > TARGET_BYTES) {
    main = await manipulateAsync(uri, resize(LONG_SIDE), { compress: 0.55, format: SaveFormat.JPEG });
    size = await fileSize(main.uri);
  }
  const thumb = await manipulateAsync(uri, resize(THUMB_SIDE), { compress: 0.5, format: SaveFormat.JPEG });
  return { key: uuid(), localUri: main.uri, thumbUri: thumb.uri, width: main.width, height: main.height, size: size ?? undefined };
}

/**
 * Картинка из файла Excel (ITSM, столбец «Фото») → сжатое фото, как снятое на телефоне.
 * Исходные байты пишутся во временный файл только на время сжатия и сразу удаляются.
 */
export async function photoFromBytes(bytes: Uint8Array, ext: string): Promise<DraftPhoto> {
  const { manipulateAsync } = await import('expo-image-manipulator');
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: `image/${ext}` }));
    try {
      const probe = await manipulateAsync(url, []);
      return await preparePhoto(url, probe.width, probe.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const fs: typeof import('expo-file-system') = require('expo-file-system');
  const src = new fs.File(fs.Paths.cache, `itsm-${uuid()}.${ext === 'jpeg' ? 'jpg' : ext}`);
  src.create();
  src.write(bytes);
  try {
    const probe = await manipulateAsync(src.uri, []);
    return await preparePhoto(src.uri, probe.width, probe.height);
  } finally {
    try {
      src.delete();
    } catch {
      // временный файл в кэше — система всё равно его уберёт
    }
  }
}

/** Удалить с телефона сжатые копии (после загрузки или отмены). */
export function forgetLocalPhotos(photos: DraftPhoto[]) {
  if (Platform.OS === 'web') return;
  const fs: typeof import('expo-file-system') = require('expo-file-system');
  for (const p of photos)
    for (const uri of [p.localUri, p.thumbUri]) {
      if (!uri) continue;
      try {
        const f = new fs.File(uri);
        if (f.exists) f.delete();
      } catch {
        // не страшно: это кэш
      }
    }
}

async function readBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web' || uri.startsWith('blob:') || uri.startsWith('data:')) {
    return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  }
  const { File } = await import('expo-file-system');
  return await new File(uri).bytes();
}

async function fileSize(uri: string): Promise<number | null> {
  try {
    if (Platform.OS === 'web') return (await readBytes(uri)).length;
    const { File } = await import('expo-file-system');
    return new File(uri).size;
  } catch {
    return null;
  }
}

/**
 * Загружает ещё не загруженные фото (у которых нет path). Уже загруженные пропускает —
 * поэтому «Повторить» после обрыва связи догружает только недостающее.
 * onUploaded вызывается после каждого фото, чтобы сохранить путь в черновик.
 */
export async function uploadPhotos(
  photos: DraftPhoto[],
  onUploaded: (photo: DraftPhoto) => void,
  onProgress: (done: number, total: number) => void,
) {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Войдите в приложение заново');
  const todo = photos.filter((p) => !p.path);
  let done = 0;
  onProgress(done, todo.length);
  for (const p of todo) {
    if (!p.localUri || !p.thumbUri) throw new Error('Фото не найдено на телефоне — удалите его и добавьте снова');
    const id = uuid();
    const path = `${uid}/${id}.jpg`;
    const thumbPath = `${uid}/${id}_t.jpg`;
    for (const [target, src] of [
      [thumbPath, p.thumbUri],
      [path, p.localUri],
    ] as const) {
      const { error } = await supabase.storage.from(BUCKET).upload(target, await readBytes(src), {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (error && !/exists/i.test(error.message)) throw error;
    }
    const uploaded = { ...p, path, thumbPath };
    onUploaded(uploaded);
    done++;
    onProgress(done, todo.length);
  }
}

/** Для отправки на сервер: только загруженные фото. */
export function toPayload(photos: DraftPhoto[] | undefined) {
  return (photos ?? [])
    .filter((p) => p.path && p.thumbPath)
    .map((p) => ({ path: p.path, thumb_path: p.thumbPath, width: p.width ?? null, height: p.height ?? null, size_bytes: p.size ?? null }));
}

// ---------- Просмотр: подписанные ссылки с коротким сроком ----------
const LINK_TTL_S = 600;
const linkCache = new Map<string, { url: string; at: number }>();

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const need: string[] = [];
  for (const p of paths) {
    const c = linkCache.get(p);
    if (c && now - c.at < (LINK_TTL_S - 120) * 1000) out[p] = c.url;
    else need.push(p);
  }
  if (need.length) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(need, LINK_TTL_S);
    if (error) throw error;
    for (const r of data ?? []) {
      if (r.path && r.signedUrl) {
        const link = viaServerBase(r.signedUrl);
        out[r.path] = link;
        linkCache.set(r.path, { url: link, at: now });
      }
    }
  }
  return out;
}

/** Фото для списка работ: id работы → фото по порядку. */
export async function fetchEntryPhotos(entryIds: number[]): Promise<Record<number, RemotePhoto[]>> {
  if (!entryIds.length) return {};
  const { data, error } = await supabase.rpc('entry_photos_for', { p_entry_ids: entryIds });
  if (error) throw error;
  const map: Record<number, RemotePhoto[]> = {};
  for (const r of (data ?? []) as RemotePhoto[]) (map[r.entry_id] ??= []).push(r);
  return map;
}

export function remoteToDraft(photos: RemotePhoto[] | undefined): DraftPhoto[] {
  return (photos ?? []).map((p) => ({ key: p.path, path: p.path, thumbPath: p.thumb_path }));
}

/** Загрузить все ещё не загруженные фото и вернуть список с путями в хранилище. */
export async function uploadAll(photos: DraftPhoto[], onProgress: (text: string | null) => void): Promise<DraftPhoto[]> {
  const done = new Map<string, DraftPhoto>();
  if (photos.some((p) => !p.path)) {
    await uploadPhotos(
      photos,
      (p) => done.set(p.key, p),
      (n, total) => onProgress(`Загружаем фото: ${n} из ${total}`),
    );
  }
  onProgress(null);
  return photos.map((p) => done.get(p.key) ?? p);
}
