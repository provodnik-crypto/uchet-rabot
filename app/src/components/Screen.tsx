import { useCallback, useRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TourScrollProvider } from '../lib/tour';
import { colors } from '../theme';

/** Общая обёртка экрана: серый фон, отступы, прокрутка, клавиатура не перекрывает поля. */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  // обучение прокручивает экран к подсвеченному элементу
  const scrollBy = useCallback((dy: number) => {
    offset.current = Math.max(0, offset.current + dy);
    ref.current?.scrollTo({ y: offset.current, animated: false });
  }, []);
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <TourScrollProvider value={scrollBy}>
            <ScrollView
              ref={ref}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={32}
              onScroll={(e) => {
                offset.current = e.nativeEvent.contentOffset.y;
              }}
            >
              {children}
            </ScrollView>
          </TourScrollProvider>
        ) : (
          children
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
});
