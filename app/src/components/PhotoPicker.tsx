import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { humanError } from '../lib/errors';
import { MAX_PHOTOS, pickPhoto, signedUrls, type DraftPhoto } from '../lib/workPhotos';
import { colors, font, radius } from '../theme';
import { PhotoViewer } from './PhotoViewer';

type Props = {
  photos: DraftPhoto[];
  onChange: (photos: DraftPhoto[]) => void;
  /** Показать подсказку «С фото руководитель оценит быстрее», когда фото нет. */
  hint?: boolean;
  /** Хотя бы одно фото обязательно (фото результата при отправке на проверку). */
  required?: boolean;
};

/** «Добавить фото»: камера или галерея, до 3 фото, миниатюры с удалением. */
export function PhotoPicker({ photos, onChange, hint, required }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const remoteThumbs = useSignedThumbs(photos);

  async function add(source: 'camera' | 'library') {
    setError(null);
    setBusy(true);
    try {
      const p = await pickPhoto(source);
      if (p) onChange([...photos, p].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(`Не получилось добавить фото: ${humanError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function choose() {
    if (Platform.OS === 'web') return add('library');
    Alert.alert('Добавить фото', undefined, [
      { text: 'Снять камерой', onPress: () => add('camera') },
      { text: 'Выбрать из галереи', onPress: () => add('library') },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {photos.map((p, i) => {
          const uri = p.thumbUri ?? (p.thumbPath ? remoteThumbs[p.thumbPath] : undefined);
          return (
            <View key={p.key} style={styles.thumbBox}>
              <Pressable onPress={() => setViewer(i)} accessibilityRole="imagebutton" accessibilityLabel={`Фото ${i + 1}`}>
                {uri ? <Image source={{ uri }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]} />}
              </Pressable>
              <Pressable
                onPress={() => onChange(photos.filter((x) => x.key !== p.key))}
                style={styles.remove}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Удалить фото"
              >
                <Text style={styles.removeText}>✕</Text>
              </Pressable>
            </View>
          );
        })}
        {photos.length < MAX_PHOTOS ? (
          <Pressable onPress={choose} disabled={busy} style={({ pressed }) => [styles.add, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.black} /> : <Text style={styles.addPlus}>＋</Text>}
            <Text style={styles.addText}>{busy ? 'Сжимаем…' : 'Добавить фото'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.meta}>
        {photos.length ? `Фото: ${photos.length} из ${MAX_PHOTOS}. Нажмите на фото, чтобы посмотреть.` : required ? `Нужно хотя бы одно фото, всего до ${MAX_PHOTOS}` : hint ? 'С фото руководитель оценит быстрее' : `До ${MAX_PHOTOS} фото, необязательно`}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PhotoViewer
        visible={viewer !== null}
        index={viewer ?? 0}
        photos={photos.map((p) => ({ uri: p.localUri, path: p.localUri ? undefined : p.path }))}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

/** Подписанные ссылки на миниатюры уже загруженных фото (при исправлении работы). */
function useSignedThumbs(photos: DraftPhoto[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = photos.map((p) => (p.thumbUri ? '' : (p.thumbPath ?? ''))).join('|');
  useEffect(() => {
    const paths = photos.filter((p) => !p.thumbUri && p.thumbPath).map((p) => p.thumbPath!);
    if (!paths.length) return;
    signedUrls(paths).then(setUrls).catch(() => {});
  }, [key]);
  return urls;
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbBox: { position: 'relative' },
  thumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: colors.border },
  thumbEmpty: { borderWidth: 2, borderColor: colors.border },
  remove: { position: 'absolute', top: -8, right: -8, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  add: { width: 84, height: 84, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.black, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: colors.card },
  addPlus: { fontSize: 26, fontWeight: '800', lineHeight: 28 },
  addText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  meta: { fontSize: font.small, color: colors.muted },
  error: { fontSize: font.small, color: colors.danger },
});
