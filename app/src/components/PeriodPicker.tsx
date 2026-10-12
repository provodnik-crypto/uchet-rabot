import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDate, parseDate } from '../lib/dates';
import { periodLabel, presetPeriod, type Period, type PeriodPreset } from '../lib/manager';
import { colors, font } from '../theme';
import { BigButton } from './BigButton';
import { DateField } from './DateField';
import { Segmented } from './Segmented';

const PRESETS: PeriodPreset[] = ['month', 'prev', 'year', 'custom'];
/** Короткие подписи, чтобы весь выбор помещался в одну строку. */
const short: Record<PeriodPreset, string> = { month: 'Месяц', prev: 'Прошлый', year: 'Год', custom: 'Свой' };

type Props = { preset: PeriodPreset; period: Period; onChange: (preset: PeriodPreset, period: Period) => void };

/** Выбор периода: этот месяц, прошлый, год или свои даты. */
export function PeriodPicker({ preset, period, onChange }: Props) {
  const [from, setFrom] = useState(formatDate(period.from));
  const [to, setTo] = useState(formatDate(period.to));
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={styles.wrap}>
      <Segmented
        options={PRESETS.map((p) => ({ value: p, label: short[p], a11y: periodLabel[p] }))}
        value={preset}
        onChange={(p) => {
          if (p === 'custom') onChange('custom', period);
          else onChange(p, presetPeriod(p));
        }}
      />
      {preset === 'custom' ? (
        <View style={styles.custom}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <DateField label="С" value={from} onChange={setFrom} quick={false} hint="" />
            </View>
            <View style={styles.flex}>
              <DateField label="По" value={to} onChange={setTo} quick={false} hint="" />
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
  wrap: { gap: 8 },
  custom: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  range: { fontSize: font.small - 1, color: colors.secondary, paddingHorizontal: 2 },
  err: { color: colors.danger, fontSize: font.small },
});
