import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { humanError } from '../lib/errors';
import { MAX_PHOTOS, pickPhoto, signedUrls, type DraftPhoto } from '../lib/workPhotos';
import { colors, font, iconSize, opacity, radius, space, stroke, touch } from '../theme';
import { ActionSheet } from './ActionSheet';
import { Icon } from './Icon';
import { PhotoViewer } from './PhotoViewer';

type Props = {
  photos: DraftPhoto[];
  onChange: (photos: DraftPhoto[]) => void;
  /** Показать подсказку «С фото руководитель оценит быстрее», когда фото нет. */
  hint?: boolean;
  /** Хотя бы одно фото обязательно (фото результата при отправке на проверку). */
  required?: boolean;
};

/** Фото сеткой по 3 в ряд: «Снять» (камера или галерея), до 3 фото, миниатюры с удалением. */
export function PhotoPicker({ photos, onChange, hint, required }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  // ширина клетки: три в ряд с промежутком
  const [width, setWidth] = useState(0);
  const cell = width ? Math.floor((width - space.s8 * 2) / 3) : 0;
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
    setSheet(true);
  }

  return (
    <View style={styles.wrap}>
      <ActionSheet
        visible={sheet}
        title="Фото: без людей и документов"
        actions={[
          { label: 'Снять камерой', onPress: () => add('camera') },
          { label: 'Выбрать из галереи', onPress: () => add('library') },
        ]}
        onClose={() => setSheet(false)}
      />
      <View style={styles.row} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {photos.map((p, i) => {
          const uri = p.thumbUri ?? (p.thumbPath ? remoteThumbs[p.thumbPath] : undefined);
          return (
            <View key={p.key} style={[styles.thumbBox, { width: cell, height: cell }]}>
              <Pressable onPress={() => setViewer(i)} accessibilityRole="imagebutton" accessibilityLabel={`Фото ${i + 1}`}>
                {uri ? <Image source={{ uri }} style={[styles.thumb, { width: cell, height: cell }]} /> : <View style={[styles.thumb, { width: cell, height: cell }]} />}
              </Pressable>
              <Pressable
                onPress={() => onChange(photos.filter((x) => x.key !== p.key))}
                style={styles.remove}
                hitSlop={space.s10}
                accessibilityRole="button"
                accessibilityLabel="Удалить фото"
              >
                <Icon name="close" size={iconSize.small} color={colors.white} />
              </Pressable>
            </View>
          );
        })}
        {photos.length < MAX_PHOTOS ? (
          <Pressable
            onPress={choose}
            disabled={busy}
            style={({ pressed }) => [styles.add, { width: cell, height: cell }, pressed && { opacity: opacity.pressed }]}
            accessibilityRole="button"
            accessibilityLabel="Снять фото"
          >
            {busy ? <ActivityIndicator color={colors.black} /> : <Icon name="camera" size={iconSize.big} />}
            <Text style={styles.addText}>{busy ? 'Сжимаем…' : 'Снять'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.meta}>
        Не снимайте людей и документы.{' '}
        {photos.length ? `Фото: ${photos.length} из ${MAX_PHOTOS}.` : required ? `Нужно хотя бы одно фото, всего до ${MAX_PHOTOS}.` : hint ? 'С фото руководитель оценит быстрее.' : `До ${MAX_PHOTOS} фото, необязательно.`}
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
  wrap: { gap: space.s8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  thumbBox: { position: 'relative' },
  thumb: { borderRadius: radius.small, backgroundColor: colors.border },
  remove: {
    position: 'absolute',
    top: space.s4,
    right: space.s4,
    width: touch.tiny,
    height: touch.tiny,
    borderRadius: radius.round,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    borderRadius: radius.small,
    borderWidth: stroke.outline,
    borderStyle: 'dashed',
    borderColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s4,
    backgroundColor: colors.card,
  },
  addText: { fontSize: font.caption, fontWeight: '600', textAlign: 'center' },
  meta: { fontSize: font.caption, color: colors.secondary },
  error: { fontSize: font.small, color: colors.danger },
});
