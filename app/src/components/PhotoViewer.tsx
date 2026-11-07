import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, FlatList, Image, Modal, PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Text } from './Text';
import { signedUrls } from '../lib/workPhotos';
import { colors, font, radius, space, touch } from '../theme';

/** Что показывать: локальный файл (до отправки) или путь в хранилище. */
export type ViewerPhoto = { uri?: string; path?: string };

type Props = { photos: ViewerPhoto[]; index: number; visible: boolean; onClose: () => void };

/** Фото на весь экран: листать пальцем, увеличивать щипком или двойным касанием. */
export function PhotoViewer({ photos, index, visible, onClose }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { width, height } = Dimensions.get('window');

  useEffect(() => {
    if (!visible) return;
    setCurrent(index);
    const paths = photos.filter((p) => !p.uri && p.path).map((p) => p.path!);
    if (!paths.length) return;
    signedUrls(paths)
      .then(setUrls)
      .catch(() => setError('Не удалось загрузить фото. Проверьте интернет.'));
  }, [visible, photos, index]);

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="fade" transparent={false} statusBarTranslucent>
      <View style={styles.bg}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(p, i) => `${p.path ?? p.uri}${i}`}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => {
            const uri = item.uri ?? (item.path ? urls[item.path] : undefined);
            return (
              <View style={{ width, height }}>
                {uri ? <ZoomableImage uri={uri} width={width} height={height} onZoom={setZoomed} /> : <ActivityIndicator color={colors.white} style={styles.center} />}
              </View>
            );
          }}
        />
        <View style={styles.top}>
          <Text style={styles.counter}>
            {current + 1} / {photos.length}
          </Text>
          <Pressable onPress={onClose} style={styles.close} hitSlop={space.s12} accessibilityRole="button" accessibilityLabel="Закрыть">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.hint}>Листайте пальцем · увеличение — щипком или двойным касанием</Text>
      </View>
    </Modal>
  );
}

const dist = (e: GestureResponderEvent) => {
  const [a, b] = e.nativeEvent.touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
};

function ZoomableImage({ uri, width, height, onZoom }: { uri: string; width: number; height: number; onZoom: (z: boolean) => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const s = useRef({ scale: 1, x: 0, y: 0, startScale: 1, startDist: 0, startX: 0, startY: 0, lastTap: 0, moved: false });

  const apply = (k: number, x: number, y: number) => {
    const st = s.current;
    st.scale = k;
    st.x = x;
    st.y = y;
    scale.setValue(k);
    tx.setValue(x);
    ty.setValue(y);
    onZoom(k > 1.01);
  };
  const clampPan = (k: number, x: number, y: number) => {
    const mx = ((k - 1) * width) / 2;
    const my = ((k - 1) * height) / 2;
    return [Math.max(-mx, Math.min(mx, x)), Math.max(-my, Math.min(my, y))] as const;
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e, g) => e.nativeEvent.touches.length === 2 || (s.current.scale > 1.01 && (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2)),
      onPanResponderGrant: (e) => {
        const st = s.current;
        st.moved = false;
        st.startScale = st.scale;
        st.startX = st.x;
        st.startY = st.y;
        st.startDist = e.nativeEvent.touches.length === 2 ? dist(e) : 0;
      },
      onPanResponderMove: (e, g) => {
        const st = s.current;
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) st.moved = true;
        if (e.nativeEvent.touches.length === 2) {
          if (!st.startDist) {
            st.startDist = dist(e);
            st.startScale = st.scale;
            return;
          }
          const k = Math.max(1, Math.min(4, (st.startScale * dist(e)) / st.startDist));
          const [x, y] = clampPan(k, st.x, st.y);
          apply(k, x, y);
        } else if (st.scale > 1.01) {
          const [x, y] = clampPan(st.scale, st.startX + g.dx, st.startY + g.dy);
          apply(st.scale, x, y);
        }
      },
      onPanResponderRelease: () => {
        const st = s.current;
        st.startDist = 0;
        if (!st.moved) {
          const now = Date.now();
          if (now - st.lastTap < 300) {
            if (st.scale > 1.01) apply(1, 0, 0);
            else apply(2.5, 0, 0);
            st.lastTap = 0;
            return;
          }
          st.lastTap = now;
        }
        if (st.scale < 1.05) apply(1, 0, 0);
      },
      onPanResponderTerminationRequest: () => s.current.scale <= 1.01,
    }),
  ).current;

  return (
    <Animated.View
      {...responder.panHandlers}
      style={{ width, height, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}
    >
      <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1 },
  top: { position: 'absolute', top: touch.small, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.s16 },
  counter: { color: colors.white, fontSize: font.body, fontWeight: '700' },
  close: { width: touch.min, height: touch.min, borderRadius: radius.round, backgroundColor: colors.onPhotoGlass, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.white, fontSize: font.h1, fontWeight: '700' },
  hint: { position: 'absolute', bottom: space.s24, left: space.s16, right: space.s16, color: colors.onPhotoText, textAlign: 'center', fontSize: font.small },
  error: { position: 'absolute', top: space.s32, left: space.s16, right: space.s16, color: colors.errorOnDark, textAlign: 'center', fontSize: font.body },
});
