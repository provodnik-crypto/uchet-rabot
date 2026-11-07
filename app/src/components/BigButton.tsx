import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { colors, font, opacity, radius, space, stroke, touch } from '../theme';
import { Text } from './Text';

type Props = {
  title: string;
  onPress: () => void;
  /** primary — жёлтая, dark — чёрная, secondary — белая с чёрной обводкой, danger — красная. */
  variant?: 'primary' | 'dark' | 'secondary' | 'danger';
  /** small 40 · normal 48 · mid 52 · big 56 (главная кнопка экрана). */
  size?: 'small' | 'normal' | 'mid' | 'big';
  disabled?: boolean;
  loading?: boolean;
};

export function BigButton({ title, onPress, variant = 'primary', size = 'normal', disabled, loading }: Props) {
  const inactive = disabled || loading;
  const light = variant === 'dark' || variant === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      onPress={onPress}
      disabled={inactive}
      hitSlop={size === 'small' ? space.s4 : undefined}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        styles[variant],
        inactive && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={light ? colors.white : colors.black} />
      ) : (
        <Text style={[styles.text, (size === 'big' || size === 'mid') && styles.bigText, size === 'small' && styles.smallText, light && styles.lightText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.s16 },
  small: { minHeight: touch.small },
  normal: { minHeight: touch.min },
  mid: { minHeight: touch.mid },
  big: { minHeight: touch.big },
  primary: { backgroundColor: colors.brand },
  dark: { backgroundColor: colors.black },
  secondary: { backgroundColor: colors.card, borderWidth: stroke.outline, borderColor: colors.black },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
  text: { fontSize: font.body, fontWeight: '700', color: colors.black },
  bigText: { fontSize: font.text },
  smallText: { fontSize: font.small, fontWeight: '600' },
  lightText: { color: colors.white },
});
