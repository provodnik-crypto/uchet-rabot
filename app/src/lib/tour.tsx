import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '../components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, lineHeight, radius, space, stroke, touch, tourShadow } from '../theme';
import { useAuth } from './auth';
import { TOURS, WHATS_NEW, type TourId, type WhatsNew } from './tours';

/**
 * Обучение поверх настоящих экранов: затемнение с «окном» вокруг нужного элемента и подсказка.
 * Элементы помечаются <TourTarget id="…">; их положение меряется на телефоне каждые 250 мс,
 * поэтому подсветка совпадает на любом размере экрана и после прокрутки.
 */

type Reg = {
  ref: React.RefObject<View | null>;
  scrollBy?: (dy: number) => void;
};
type Rect = { x: number; y: number; w: number; h: number };
type Active = { tour: TourId; step: number };

type TourApi = {
  active: Active | null;
  start: (id: TourId) => void;
  /** Главный экран: при первом входе — обучение, после обновления — «Что нового». */
  autoStart: (role: 'master' | 'manager', existingUser: boolean) => void;
  showWhatsNew: (entry?: WhatsNew) => void;
  register: (id: string, reg: Reg) => () => void;
};

const TourCtx = createContext<TourApi | null>(null);
const ScrollCtx = createContext<((dy: number) => void) | undefined>(undefined);

/** Прокрутка экрана для подсветки элементов ниже края (даёт Screen). */
export const TourScrollProvider = ScrollCtx.Provider;
/** Прокрутить экран на dy (даёт Screen); нужен и полю сообщения, чтобы держать его над клавиатурой. */
export const useScrollBy = () => useContext(ScrollCtx);

const key = (userId: number, what: string) => `tour-v1:${userId}:${what}`;
const FIRST: Record<'master' | 'manager', TourId> = {
  master: 'first',
  manager: 'mfirst',
};

export function TourProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const registry = useRef(new Map<string, Reg>()).current;
  const [active, setActive] = useState<Active | null>(null);
  const [news, setNews] = useState<WhatsNew | null>(null);
  const autoDone = useRef<number | null>(null);

  const register = useCallback(
    (id: string, reg: Reg) => {
      registry.set(id, reg);
      return () => {
        if (registry.get(id) === reg) registry.delete(id);
      };
    },
    [registry],
  );

  const markDone = useCallback(
    (id: TourId) => {
      if (me) AsyncStorage.setItem(key(me.id, id), '1').catch(() => {});
    },
    [me],
  );

  const start = useCallback((id: TourId) => setActive({ tour: id, step: 0 }), []);

  const finish = useCallback(
    (completed: boolean) => {
      setActive((a) => {
        if (!a) return a;
        markDone(a.tour);
        const then = TOURS[a.tour].then;
        return completed && then ? { tour: then, step: 0 } : null;
      });
    },
    [markDone],
  );

  const showWhatsNew = useCallback((entry?: WhatsNew) => setNews(entry ?? WHATS_NEW[0] ?? null), []);

  const autoStart = useCallback(
    async (role: 'master' | 'manager', existingUser: boolean) => {
      if (!me || autoDone.current === me.id) return;
      autoDone.current = me.id;
      try {
        const first = FIRST[role];
        const latest = WHATS_NEW[0]?.id;
        const [done, seen] = await Promise.all([AsyncStorage.getItem(key(me.id, first)), AsyncStorage.getItem(key(me.id, 'whats-new'))]);
        if (!done && !existingUser) {
          // новый сотрудник: обучение вместо «Что нового»
          await AsyncStorage.setItem(key(me.id, 'whats-new'), latest ?? '');
          start(first);
          return;
        }
        if (!done) await AsyncStorage.setItem(key(me.id, first), '1');
        if (latest && seen !== latest) {
          await AsyncStorage.setItem(key(me.id, 'whats-new'), latest);
          setNews(WHATS_NEW[0]);
        }
      } catch {
        // без хранилища просто не показываем
      }
    },
    [me, start],
  );

  // выход из учётной записи — обучение прерывается
  useEffect(() => {
    if (!me) {
      setActive(null);
      autoDone.current = null;
    }
  }, [me]);

  const api = useMemo(() => ({ active, start, autoStart, showWhatsNew, register }), [active, start, autoStart, showWhatsNew, register]);

  return (
    <TourCtx.Provider value={api}>
      {children}
      {active ? <TourOverlay active={active} registry={registry} setActive={setActive} finish={finish} /> : null}
      <WhatsNewModal entry={news} role={me?.role === 'manager' ? 'manager' : 'master'} onClose={() => setNews(null)} />
    </TourCtx.Provider>
  );
}

export function useTour(): TourApi {
  const ctx = useContext(TourCtx);
  if (!ctx) throw new Error('useTour вне TourProvider');
  return ctx;
}

/** Помечает элемент для подсветки. Регистрируется, только пока его экран открыт. */
export function TourTarget({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);
  const focused = useIsFocused();
  const scrollBy = useContext(ScrollCtx);
  const ctx = useContext(TourCtx);
  useEffect(() => {
    if (!focused || !ctx) return;
    return ctx.register(id, { ref, scrollBy });
  }, [focused, ctx, id, scrollBy]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}

// ---------- Слой подсветки ----------

const PAD = 6;
const HEADER = 56;

function TourOverlay({
  active,
  registry,
  setActive,
  finish,
}: {
  active: Active;
  registry: Map<string, Reg>;
  setActive: (fn: (a: Active | null) => Active | null) => void;
  finish: (completed: boolean) => void;
}) {
  const tour = TOURS[active.tour];
  const step = tour.steps[active.step];
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rect, setRect] = useState<Rect | null>(null);
  const [kb, setKb] = useState(0);
  const seen = useRef(false);

  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const b = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  useEffect(() => {
    seen.current = false;
    setRect(null);
  }, [active.tour, active.step]);

  useEffect(() => {
    const goTo = (i: number) => setActive((a) => (a && a.tour === active.tour ? { ...a, step: i } : a));
    const tick = () => {
      const steps = tour.steps;
      const i = active.step;
      const cur = registry.get(steps[i].target);
      if (!cur) {
        // нужного элемента нет: возможно, мастер пошёл другим путём — ищем следующий шаг, который уже на экране
        for (let j = i + 1; j < steps.length; j++) {
          if (registry.has(steps[j].target)) return goTo(j);
        }
        // шаг «нажмите» выполнен: элемент исчез с экрана — следующий шаг (или конец обучения)
        if (seen.current && steps[i].kind === 'tap') return i === steps.length - 1 ? finish(true) : goTo(i + 1);
        setRect(null);
        return;
      }
      // шаг «нажмите»: следующий экран открылся
      const nxt = steps[i + 1];
      if (steps[i].kind === 'tap' && nxt && nxt.target !== steps[i].target && registry.has(nxt.target)) return goTo(i + 1);
      cur.ref.current?.measureInWindow((x, y, w, h) => {
        if (!w || !h) return setRect(null);
        seen.current = true;
        const top = insets.top + HEADER + 8;
        const bottom = winH - Math.max(kb, insets.bottom) - 170;
        if (cur.scrollBy && (y < top || y + h > bottom)) {
          const dy = y < top || h > bottom - top ? y - top : y + h - bottom;
          if (Math.abs(dy) > 4) cur.scrollBy(dy);
        }
        setRect((r) => (r && r.x === x && r.y === y && r.w === w && r.h === h ? r : { x, y, w, h }));
      });
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [active, tour, registry, setActive, finish, insets.top, insets.bottom, winH, kb]);

  const next = () => (active.step + 1 < tour.steps.length ? setActive((a) => (a ? { ...a, step: a.step + 1 } : a)) : finish(true));
  const skip = () => finish(false);
  const counter = `${tour.title} · ${active.step + 1} из ${tour.steps.length}`;
  const isLast = active.step + 1 === tour.steps.length;

  if (!rect) {
    // элемент ещё не на экране — подсказка внизу, ничего не затемняем
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View style={[styles.pill, { bottom: Math.max(kb, insets.bottom) + 12 }]}>
          <Text style={styles.counter}>{counter}</Text>
          <Text style={styles.text}>{step.text}</Text>
          <View style={styles.buttons}>
            <Pressable accessibilityRole="button" onPress={skip} style={styles.skip} hitSlop={space.s8}>
              <Text style={styles.skipText}>Пропустить</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (step.free) {
    // только рамка, экран доступен целиком; подсказка внизу
    const fb = { x: Math.max(0, rect.x - PAD), y: Math.max(0, rect.y - PAD), w: rect.w + PAD * 2, h: rect.h + PAD * 2 };
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View pointerEvents="none" style={[styles.frame, { left: fb.x, top: fb.y, width: fb.w, height: fb.h }]} />
        <View style={[styles.pill, { bottom: Math.max(kb, insets.bottom) + 12 }]}>
          <Text style={styles.counter}>{counter}</Text>
          <Text style={styles.text}>{step.text}</Text>
          <View style={styles.buttons}>
            <Pressable accessibilityRole="button" onPress={skip} style={styles.skip} hitSlop={space.s8}>
              <Text style={styles.skipText}>Пропустить</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const hole = {
    x: Math.max(0, rect.x - PAD),
    y: Math.max(0, rect.y - PAD),
    w: rect.w + PAD * 2,
    h: rect.h + PAD * 2,
  };
  const visibleBottom = winH - Math.max(kb, insets.bottom);
  const below = visibleBottom - (hole.y + hole.h) > 190 || hole.y < 200;
  const tipPos = below ? { top: Math.min(hole.y + hole.h + 10, visibleBottom - 170) } : { bottom: winH - hole.y + 10 };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* четыре полосы затемнения вокруг «окна»; касание по ним не проходит к экрану */}
      <View onStartShouldSetResponder={() => true} style={[styles.dim, { left: 0, top: 0, width: winW, height: hole.y }]} />
      <View onStartShouldSetResponder={() => true} style={[styles.dim, { left: 0, top: hole.y + hole.h, width: winW, bottom: 0 }]} />
      <View onStartShouldSetResponder={() => true} style={[styles.dim, { left: 0, top: hole.y, width: hole.x, height: hole.h }]} />
      <View onStartShouldSetResponder={() => true} style={[styles.dim, { left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h }]} />
      <View pointerEvents="none" style={[styles.frame, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]} />
      <View style={[styles.tip, tipPos]}>
        <Text style={styles.counter}>{counter}</Text>
        <Text style={styles.text}>{step.text}</Text>
        <View style={styles.buttons}>
          <Pressable accessibilityRole="button" onPress={skip} style={styles.skip} hitSlop={space.s8}>
            <Text style={styles.skipText}>Пропустить</Text>
          </Pressable>
          {step.kind === 'next' ? (
            <Pressable accessibilityRole="button" onPress={next} style={styles.nextBtn}>
              <Text style={styles.nextText}>{isLast && !tour.then ? 'Готово' : 'Далее'}</Text>
            </Pressable>
          ) : (
            <Text style={styles.tapHint}>Нажмите на подсвеченное</Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------- «Что нового» ----------

function WhatsNewModal({ entry, role, onClose }: { entry: WhatsNew | null; role: 'master' | 'manager'; onClose: () => void }) {
  if (!entry) return null;
  const items = role === 'manager' ? entry.manager : entry.master;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.newsCard}>
          <Text style={styles.newsTitle}>Что нового</Text>
          <Text style={styles.counter}>Обновление от {entry.date}</Text>
          {items.map((t) => (
            <View key={t} style={styles.newsRow}>
              <Text style={styles.newsDot}>•</Text>
              <Text style={styles.newsText}>{t}</Text>
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.nextBtn, styles.newsBtn]}>
            <Text style={styles.nextText}>Понятно</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: colors.overlayStrong },
  frame: {
    position: 'absolute',
    borderRadius: radius.control,
    borderWidth: stroke.outline,
    borderColor: colors.brand,
  },
  tip: {
    position: 'absolute',
    left: space.s12,
    right: space.s12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.s14,
    gap: space.s8,
    ...tourShadow,
    shadowColor: colors.black,
  },
  pill: {
    position: 'absolute',
    left: space.s12,
    right: space.s12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: stroke.outline,
    borderColor: colors.brand,
    padding: space.s12,
    gap: space.s6,
    ...tourShadow,
    shadowColor: colors.black,
  },
  counter: { fontSize: font.caption, color: colors.muted, fontWeight: '600' },
  text: {
    fontSize: font.body,
    lineHeight: lineHeight.body,
    color: colors.black,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s12,
  },
  skip: { paddingVertical: space.s10, paddingHorizontal: space.s4 },
  skipText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
  nextBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.control,
    paddingHorizontal: space.s20,
    minHeight: touch.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { fontSize: font.body, fontWeight: '800', color: colors.black },
  tapHint: { fontSize: font.small, fontWeight: '700', color: colors.black },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlayStrong,
    justifyContent: 'center',
    padding: space.s20,
  },
  newsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.s18,
    gap: space.s10,
  },
  newsTitle: { fontSize: font.title, fontWeight: '800' },
  newsRow: { flexDirection: 'row', gap: space.s8 },
  newsDot: { fontSize: font.body, fontWeight: '800', color: colors.black },
  newsText: { flex: 1, fontSize: font.body, lineHeight: lineHeight.body },
  newsBtn: { marginTop: space.s6, alignSelf: 'stretch' },
});
