import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, opacity, radius, space } from '../theme';

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  if (onPress) {
    return (
      // Небольшая задержка подсветки: при прокрутке карточка под пальцем не бледнеет.
      <Pressable onPress={onPress} unstable_pressDelay={120} style={({ pressed }) => [styles.card, style, pressed && { opacity: opacity.pressed }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: space.s16 },
});
