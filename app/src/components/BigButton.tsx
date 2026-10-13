import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, font, radius, touch } from '../theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'small' | 'normal' | 'big';
  disabled?: boolean;
  loading?: boolean;
};

export function BigButton({ title, onPress, variant = 'primary', size = 'normal', disabled, loading }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      hitSlop={size === 'small' ? 4 : undefined}
      style={({ pressed }) => [
        styles.base,
        size === 'big' && styles.big,
        size === 'small' && styles.small,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        inactive && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'danger' ? '#fff' : colors.black} />
      ) : (
        <Text style={[styles.text, size === 'big' && styles.bigText, size === 'small' && styles.smallText, variant === 'danger' && styles.dangerText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.min,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  big: { minHeight: touch.big },
  small: { minHeight: 40 },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.black },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  text: { fontSize: font.body, fontWeight: '700', color: colors.black },
  bigText: { fontSize: font.title },
  smallText: { fontSize: font.small + 1, fontWeight: '600' },
  dangerText: { color: '#fff' },
});
