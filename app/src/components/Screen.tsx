import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TourScrollProvider } from '../lib/tour';
import { colors } from '../theme';
import { LoadStatus, toList, type StatusLike } from './LoadStatus';

/** Вложенные списки со своей загрузкой (например, список заявок) подключаются к свайпу вниз экрана. */
type Refreshers = { fns: Set<() => unknown>; changed: () => void };
const RefreshContext = createContext<Refreshers | null>(null);

export function useScreenRefresh(reload: () => unknown) {
  const set = useContext(RefreshContext);
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    if (!set) return;
    const fn = () => ref.current();
    set.fns.add(fn);
    set.changed();
    return () => {
      set.fns.delete(fn);
      set.changed();
    };
  }, [set]);
}

/**
 * Android: окно приложения при клавиатуре не сжимается (экран «от края до края»), а встроенный
 * KeyboardAvoidingView под шапкой недооценивает отступ. Считаем сами: низ экрана минус верх клавиатуры.
 */
function useKeyboardInset(ref: React.RefObject<View | null>) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      ref.current?.measureInWindow((_x, y, _w, h) => setInset(Math.max(0, Math.round(y + h - e.endCoordinates.screenY))));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ref]);
  return inset;
}

/** Держать элемент над клавиатурой: если он ушёл под неё — прокрутить экран вверх. */
export function keepAboveKeyboard(target: View | null, scrollBy: ((dy: number) => void) | undefined) {
  // в веб-версии metrics нет — там клавиатура экранная у браузера
  const kb = typeof Keyboard.metrics === 'function' ? Keyboard.metrics() : undefined;
  if (!target || !scrollBy || !kb) return;
  target.measureInWindow((_x, y, _w, h) => {
    const gap = y + h + 12 - kb.screenY;
    if (gap > 0) scrollBy(gap);
  });
}

type Props = {
  children: ReactNode;
  scroll?: boolean;
  /** Загрузки экрана: включают обновление свайпом вниз, плашку ошибки и «Обновлено в …». */
  status?: StatusLike | StatusLike[];
  /** Экран показывает каркас и без данных (главная) — плашка ошибки видна, даже если данных нет. */
  frame?: boolean;
};

/** Общая обёртка экрана: серый фон, отступы, прокрутка, клавиатура не перекрывает поля. */
export function Screen({ children, scroll = true, status, frame }: Props) {
  const ref = useRef<ScrollView>(null);
  const outer = useRef<View>(null);
  const kbInset = useKeyboardInset(outer);
  const [pulled, setPulled] = useState(false);
  const [count, setCount] = useState(0);
  const [refreshers] = useState<Refreshers>(() => ({ fns: new Set(), changed: () => setCount((n) => n + 1) }));
  const list = toList(status);
  // count меняется при подключении вложенных списков — экран перерисуется и включит свайп
  const canRefresh = list.length > 0 || (count >= 0 && refreshers.fns.size > 0);
  const onRefresh = async () => {
    setPulled(true);
    try {
      await Promise.all([...list.map((s) => s.reload()), ...[...refreshers.fns].map((fn) => fn())]);
    } finally {
      setPulled(false);
    }
  };
  const offset = useRef(0);
  // обучение прокручивает экран к подсвеченному элементу
  const scrollBy = useCallback((dy: number) => {
    offset.current = Math.max(0, offset.current + dy);
    ref.current?.scrollTo({ y: offset.current, animated: false });
  }, []);
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <View ref={outer} style={[styles.flex, kbInset ? { paddingBottom: kbInset } : null]} collapsable={false}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <RefreshContext.Provider value={refreshers}>
          <TourScrollProvider value={scrollBy}>
            <ScrollView
              ref={ref}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              refreshControl={canRefresh ? <RefreshControl refreshing={pulled} onRefresh={onRefresh} colors={[colors.black]} /> : undefined}
              scrollEventThrottle={32}
              onScroll={(e) => {
                offset.current = e.nativeEvent.contentOffset.y;
              }}
            >
              <LoadStatus status={status} frame={frame} />
              {children}
            </ScrollView>
          </TourScrollProvider>
          </RefreshContext.Provider>
        ) : (
          children
        )}
      </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
});
