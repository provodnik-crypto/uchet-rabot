import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDate, parseDate } from '../lib/dates';
import { periodLabel, presetPeriod, type Period, type PeriodPreset } from '../lib/manager';
import { colors, font, radius, touch } from '../theme';
import { BigButton } from './BigButton';
import { DateField } from './DateField';

const PRESETS: PeriodPreset[] = ['month', 'prev', 'year', 'custom'];
/** Короткие подписи, чтобы весь выбор помещался в одну строку. */
const short: Record<PeriodPreset, string> = { month: 'Этот месяц', prev: 'Прошлый', year: 'Год', custom: 'Свой' };

type Props = { preset: PeriodPreset; period: Period; onChange: (preset: PeriodPreset, period: Period) => void };

/** Выбор периода: этот месяц, прошлый, год или свои даты. */
export function PeriodPicker({ preset, period, onChange }: Props) {
  const [from, setFrom] = useState(formatDate(period.from));
  const [to, setTo] = useState(formatDate(period.to));
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={styles.wrap}>
      <View style={styles.segments} accessibilityRole="tablist">
        {PRESETS.map((p) => (
          <Pressable
            key={p}
            accessibilityRole="tab"
            accessibilityState={{ selected: preset === p }}
            accessibilityLabel={periodLabel[p]}
            onPress={() => {
              if (p === 'custom') onChange('custom', period);
              else onChange(p, presetPeriod(p));
            }}
            style={[styles.segment, preset === p && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, preset === p && styles.segmentTextOn]} numberOfLines={1}>
              {short[p]}
            </Text>
          </Pressable>
        ))}
      </View>
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
  segments: { flexDirection: 'row', gap: 2, padding: 3, backgroundColor: colors.card, borderRadius: radius.control },
  segment: { flex: 1, height: touch.small + 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  segmentOn: { backgroundColor: colors.brand },
  segmentText: { fontSize: font.small },
  segmentTextOn: { fontWeight: '700' },
  custom: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  range: { fontSize: font.small - 1, color: colors.secondary, paddingHorizontal: 2 },
  err: { color: colors.danger, fontSize: font.small },
});
