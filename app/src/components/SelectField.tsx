import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, font, iconSize, opacity, radius, space, stroke, touch } from '../theme';
import { Icon } from './Icon';
import { PickerSheet, type PickerOption } from './PickerSheet';

type Props<T> = {
  label: string;
  value: T | null;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string | null;
};

/** Поле выбора одного варианта из длинного списка: нажали — снизу шторка. */
export function SelectField<T>({ label, value, options, onChange, placeholder = 'Выберите', error }: Props<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.box, error ? styles.boxError : null, pressed && { opacity: opacity.pressed }]}
      >
        <Text style={[styles.value, !current && styles.placeholder]} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <Icon name="chevronDown" size={iconSize.medium} color={colors.secondary} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PickerSheet
        visible={open}
        title={label}
        options={options}
        selected={value == null ? [] : [value]}
        onPick={(v) => {
          setOpen(false);
          onChange(v);
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s4 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  box: {
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s8,
    paddingHorizontal: space.s12,
    backgroundColor: colors.card,
    borderRadius: radius.control,
    borderWidth: stroke.hair,
    borderColor: colors.border,
  },
  boxError: { borderColor: colors.danger },
  value: { flex: 1, fontSize: font.body },
  placeholder: { color: colors.muted },
  error: { color: colors.danger, fontSize: font.small },
});
