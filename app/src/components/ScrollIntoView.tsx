import { useEffect, useRef, type ReactNode } from 'react';
import { Dimensions, View } from 'react-native';
import { useScrollBy } from '../lib/tour';

/** Панель, открытая из меню вверху, сама прокручивается в видимую часть экрана (если мастер был внизу). */
export function ScrollIntoView({ children }: { children: ReactNode }) {
  const ref = useRef<View>(null);
  const scrollBy = useScrollBy();
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.measureInWindow((_x, y) => {
        const top = 120;
        const h = Dimensions.get('window').height;
        if (scrollBy && (y < top || y > h * 0.6)) scrollBy(y - top);
      });
    }, 150);
    return () => clearTimeout(t);
  }, [scrollBy]);
  return (
    <View ref={ref} collapsable={false}>
      {children}
    </View>
  );
}
