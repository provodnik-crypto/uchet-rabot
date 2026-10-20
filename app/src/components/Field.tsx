import { forwardRef } from 'react';
import { StyleSheet, View, type TextInputProps } from 'react-native';
import { Text, TextInput } from './Text';
import { colors, font, radius, space, stroke, touch } from '../theme';

type Props = TextInputProps & { label: string; error?: string | null; hint?: string };

export const Field = forwardRef<TextInput, Props>(function Field({ label, error, hint, style, ...rest }, ref) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.muted}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.s4 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.secondary },
  input: {
    minHeight: touch.min,
    backgroundColor: colors.card,
    borderRadius: radius.small,
    borderWidth: stroke.hair,
    borderColor: colors.field,
    paddingHorizontal: space.s12,
    fontSize: font.body,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: font.small },
  hint: { color: colors.muted, fontSize: font.small },
});
