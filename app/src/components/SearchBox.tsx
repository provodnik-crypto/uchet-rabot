import { Pressable, StyleSheet, View, type TextInputProps } from 'react-native';
import { TextInput } from './Text';
import { colors, font, iconSize, radius, space, touch } from '../theme';
import { Icon } from './Icon';

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & { value: string; onChangeText: (t: string) => void; label: string };

/** Строка поиска с лупой и крестиком очистки. */
export function SearchBox({ value, onChangeText, label, style, ...rest }: Props) {
  return (
    <View style={styles.box}>
      <Icon name="search" size={iconSize.medium} color={colors.secondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        style={[styles.input, style]}
        {...rest}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Очистить" onPress={() => onChangeText('')} hitSlop={space.s12}>
          <Icon name="close" size={iconSize.small} color={colors.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.s10, height: touch.min, paddingHorizontal: space.s14, backgroundColor: colors.card, borderRadius: radius.control },
  input: { flex: 1, fontSize: font.body, color: colors.text, paddingVertical: 0 },
});
