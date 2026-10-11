import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & { value: string; onChangeText: (t: string) => void; label: string };

/** Строка поиска с лупой и крестиком очистки. */
export function SearchBox({ value, onChangeText, label, style, ...rest }: Props) {
  return (
    <View style={styles.box}>
      <Icon name="search" size={18} color={colors.secondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        style={[styles.input, style]}
        {...rest}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Очистить" onPress={() => onChangeText('')} hitSlop={12}>
          <Icon name="close" size={16} color={colors.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 12, backgroundColor: colors.card, borderRadius: radius.control },
  input: { flex: 1, fontSize: font.small + 2, color: colors.text, paddingVertical: 0 },
});
