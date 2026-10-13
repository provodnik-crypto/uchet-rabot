import { StyleSheet, View } from 'react-native';
import { formatDate, maskDateInput } from '../lib/dates';
import { storeToday, storeYesterday } from '../lib/today';
import { Chip } from './Chip';
import { Field } from './Field';

type Props = {
  label: string;
  /** Текст в виде ДД.ММ.ГГГГ. Для новой формы задайте начальное значение todayText(). */
  value: string;
  onChange: (text: string) => void;
  error?: string | null;
  hint?: string;
  /** Показывать кнопки «Сегодня» и «Вчера». */
  quick?: boolean;
};

/** Сегодняшняя дата магазина в виде ДД.ММ.ГГГГ — значение поля по умолчанию. */
export const todayText = () => formatDate(storeToday());

/** Поле даты: по умолчанию сегодня, можно исправить на прошедшую дату. Точки ставятся сами. */
export function DateField({ label, value, onChange, error, hint, quick = true }: Props) {
  const today = formatDate(storeToday());
  const yesterday = formatDate(storeYesterday());
  return (
    <View style={styles.wrap}>
      <Field
        label={label}
        value={value}
        onChangeText={(t) => onChange(maskDateInput(t))}
        placeholder="ДД.ММ.ГГГГ"
        keyboardType="number-pad"
        maxLength={10}
        selectTextOnFocus
        error={error}
        hint={hint ?? 'По умолчанию сегодня. Для прошедшей даты исправьте цифры.'}
      />
      {quick ? (
        <View style={styles.chips}>
          <Chip label="Сегодня" selected={value === today} onPress={() => onChange(today)} />
          <Chip label="Вчера" selected={value === yesterday} onPress={() => onChange(yesterday)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  chips: { flexDirection: 'row', gap: 8 },
});
