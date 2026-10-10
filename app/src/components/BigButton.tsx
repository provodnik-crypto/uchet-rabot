import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, font, radius, touch } from '../theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'normal' | 'big';
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
      style={({ pressed }) => [
        styles.base,
        size === 'big' && styles.big,
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
        <Text style={[styles.text, size === 'big' && styles.bigText, variant === 'danger' && styles.dangerText]}>
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
    paddingHorizontal: 20,
  },
  big: { minHeight: touch.big + 24 },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.black },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  text: { fontSize: font.body, fontWeight: '700', color: colors.black },
  bigText: { fontSize: font.title },
  dangerText: { color: '#fff' },
});
