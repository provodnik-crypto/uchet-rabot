import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { signedUrls, type RemotePhoto } from '../lib/workPhotos';
import { colors, font, radius, size, space, stroke } from '../theme';
import { PhotoViewer } from './PhotoViewer';

/** Миниатюры уже отправленных фото; по нажатию — на весь экран. size="small" — одна миниатюра со счётчиком. */
export function PhotoStrip({ photos, size = 'normal' }: { photos: RemotePhoto[] | undefined; size?: 'normal' | 'small' }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<number | null>(null);
  const list = photos ?? [];
  const key = list.map((p) => p.thumb_path).join('|');
  useEffect(() => {
    if (!list.length) return;
    signedUrls((size === 'small' ? list.slice(0, 1) : list).map((p) => p.thumb_path))
      .then(setUrls)
      .catch(() => {});
  }, [key, size]);
  if (!list.length) return null;

  const viewerEl = (
    <PhotoViewer visible={viewer !== null} index={viewer ?? 0} photos={list.map((p) => ({ path: p.path }))} onClose={() => setViewer(null)} />
  );
  if (size === 'small') {
    const uri = urls[list[0].thumb_path];
    return (
      <Pressable onPress={() => setViewer(0)} style={styles.small} accessibilityRole="imagebutton" accessibilityLabel={`Фото работы: ${list.length}`}>
        {uri ? <Image source={{ uri }} style={styles.smallImg} /> : <View style={[styles.smallImg, styles.empty]} />}
        {list.length > 1 ? <Text style={styles.badge}>{list.length}</Text> : null}
        {viewerEl}
      </Pressable>
    );
  }
  return (
    <View style={styles.row}>
      {list.map((p, i) => {
        const uri = urls[p.thumb_path];
        return (
          <Pressable key={p.path} onPress={() => setViewer(i)} accessibilityRole="imagebutton" accessibilityLabel={`Фото ${i + 1}`}>
            {uri ? <Image source={{ uri }} style={styles.img} /> : <View style={[styles.img, styles.empty]} />}
          </Pressable>
        );
      })}
      {viewerEl}
    </View>
  );
}

/** Значок «📷 N» для списков: по нажатию открывает фото. */
export function PhotoBadge({ photos }: { photos: RemotePhoto[] | undefined }) {
  const [viewer, setViewer] = useState<number | null>(null);
  if (!photos?.length) return null;
  return (
    <>
      <Pressable onPress={() => setViewer(0)} style={styles.pill} hitSlop={space.s8} accessibilityRole="button" accessibilityLabel={`Фото: ${photos.length}`}>
        <Text style={styles.pillText}>📷 {photos.length}</Text>
      </Pressable>
      <PhotoViewer visible={viewer !== null} index={0} photos={photos.map((p) => ({ path: p.path }))} onClose={() => setViewer(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  img: { width: size.thumb, height: size.thumb, borderRadius: radius.control, backgroundColor: colors.border },
  empty: { borderWidth: stroke.outline, borderColor: colors.border },
  small: { position: 'relative' },
  smallImg: { width: size.thumbSmall, height: size.thumbSmall, borderRadius: radius.small, backgroundColor: colors.border },
  badge: { position: 'absolute', right: -space.s6, bottom: -space.s6, backgroundColor: colors.black, color: colors.white, fontWeight: '800', fontSize: font.caption, minWidth: size.badge, textAlign: 'center', borderRadius: radius.control, paddingHorizontal: space.s6, overflow: 'hidden' },
  pill: { alignSelf: 'flex-start', backgroundColor: colors.bg, borderRadius: radius.card, paddingHorizontal: space.s10, paddingVertical: space.s4, marginTop: space.s4 },
  pillText: { fontSize: font.small, fontWeight: '700' },
});
