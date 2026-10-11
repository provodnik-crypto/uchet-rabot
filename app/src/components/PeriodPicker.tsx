import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDate, parseDate } from '../lib/dates';
import { periodLabel, presetPeriod, type Period, type PeriodPreset } from '../lib/manager';
import { colors, font } from '../theme';
import { BigButton } from './BigButton';
import { Chip } from './Chip';
import { Field } from './Field';

type Props = { preset: PeriodPreset; period: Period; onChange: (preset: PeriodPreset, period: Period) => void };

/** Выбор периода: этот месяц, прошлый, год или свои даты. */
export function PeriodPicker({ preset, period, onChange }: Props) {
  const [from, setFrom] = useState(formatDate(period.from));
  const [to, setTo] = useState(formatDate(period.to));
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {(Object.keys(periodLabel) as PeriodPreset[]).map((p) => (
          <Chip
            key={p}
            label={periodLabel[p]}
            selected={preset === p}
            onPress={() => {
              if (p === 'custom') onChange('custom', period);
              else onChange(p, presetPeriod(p));
            }}
          />
        ))}
      </View>
      {preset === 'custom' ? (
        <View style={styles.custom}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label="С" value={from} onChangeText={setFrom} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" />
            </View>
            <View style={styles.flex}>
              <Field label="По" value={to} onChangeText={setTo} placeholder="ДД.ММ.ГГГГ" keyboardType="numbers-and-punctuation" />
            </View>
          </View>
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <BigButton
            title="Показать"
            variant="secondary"
            onPress={() => {
              const f = parseDate(from);
              const t = parseDate(to);
              if (!f || !t) return setError('Даты в виде ДД.ММ.ГГГГ');
              if (f > t) return setError('Начало периода позже конца');
              setError(null);
              onChange('custom', { from: f, to: t });
            }}
          />
        </View>
      ) : (
        <Text style={styles.range}>
          {formatDate(period.from)} — {formatDate(period.to)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  custom: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  range: { fontSize: font.small, color: colors.muted },
  err: { color: colors.danger, fontSize: font.small },
});
