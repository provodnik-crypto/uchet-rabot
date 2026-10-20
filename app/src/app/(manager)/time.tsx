import { useState } from 'react';
import { requestLabel } from '../../lib/requests';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Card } from '../../components/Card';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { formatDate } from '../../lib/dates';
import { useEmployeeIcons } from '../../lib/employeeIcons';
import { presetPeriod, timeStats, type PeriodPreset } from '../../lib/manager';
import { formatMinutes, formatPlan, hours, ratioText } from '../../lib/requestTime';
import { useFocusQuery } from '../../lib/useQuery';
import { TourTarget } from '../../lib/tour';
import { colors, font } from '../../theme';

export default function TimeScreen() {
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [period, setPeriod] = useState(presetPeriod('month'));
  const icons = useEmployeeIcons();
  const query = useFocusQuery(() => timeStats(period), { key: `time:${period.from}:${period.to}` });
  const { data, error, loading, reload } = query;

  const maxAvg = Math.max(1, ...(data?.kinds.map((k) => k.avg_minutes) ?? [1]));
  const carriedShare = data && data.requests ? Math.round((data.carried / data.requests) * 100) : 0;

  return (
    <Screen status={query}>
      <PeriodPicker
        preset={preset}
        period={period}
        onChange={(p, per) => {
          setPreset(p);
          setPeriod(per);
        }}
      />
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <TourTarget id="time.total">
          <Card style={styles.total}>
            <Text style={styles.totalLabel}>Отмечено времени</Text>
            <Text style={styles.totalSum}>{hours(data.minutes)} ч</Text>
            <Text style={styles.totalMeta}>
              Заявок в работе: {data.requests} · выполнено: {data.done}
            </Text>
            <Text style={styles.totalMeta}>
              Не закончены за один день (перенос): {data.carried} ({carriedShare}%)
            </Text>
            <Text style={[styles.totalMeta, data.over_plan.length > 0 && styles.warn]}>Дольше плана: {data.over_plan.length}</Text>
          </Card>
          </TourTarget>

          <TourTarget id="time.kinds">
            <Text style={styles.section}>По видам работ</Text>
          </TourTarget>
          {data.kinds.length === 0 ? <Text style={styles.meta}>За период нет выполненных заявок с отмеченным временем.</Text> : null}
          {data.kinds.map((k) => (
            <Card key={k.kind} style={styles.card}>
              <Text style={styles.name}>{k.kind}</Text>
              <View style={styles.barBg}>
                <View style={[styles.bar, { width: `${(k.avg_minutes / maxAvg) * 100}%` }]} />
              </View>
              <Text style={styles.meta}>
                в среднем {formatMinutes(k.avg_minutes)} · медиана {formatMinutes(k.median_minutes)} · заявок: {k.jobs}
              </Text>
            </Card>
          ))}
          <Text style={styles.meta}>
            Время заявки делится между её работами по стоимости. Работы без заявки за смену считаются одной заявкой. Незаконченные
            заявки в среднее не входят.
          </Text>

          <TourTarget id="time.masters">
            <Text style={styles.section}>Мастера</Text>
          </TourTarget>
          {data.masters.length === 0 ? <Text style={styles.meta}>Нет данных за период.</Text> : null}
          {data.masters.map((m) => {
            const r = ratioText(m.ratio);
            return (
              <Card key={m.employee_id} style={styles.card}>
                <View style={styles.row}>
                  <Avatar name={m.display_name} icon={icons[m.employee_id]} size={44} />
                  <View style={styles.flex}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.display_name}
                    </Text>
                    <Text style={[styles.ratio, r.tone === 'good' && styles.good, r.tone === 'bad' && styles.bad]}>{r.text}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  выполнено заявок: {m.requests}
                  {m.jobs > m.requests ? ` · смен с работами без заявки: ${m.jobs - m.requests}` : ''} · время: {formatMinutes(m.minutes)} при среднем{' '}
                  {formatMinutes(m.expected_minutes)}
                  {m.jobs < 3 ? ' · мало данных' : ''}
                </Text>
              </Card>
            );
          })}
          <Text style={styles.meta}>
            Сравнение честное: время мастера сопоставляется со средним по тем же видам работ. Совместная работа засчитывается каждому
            исполнителю целиком.
          </Text>

          <Text style={styles.section}>Дольше плана</Text>
          {data.over_plan.length === 0 ? <Text style={styles.meta}>Нет заявок, где факт больше плана.</Text> : null}
          {data.over_plan.map((o) => (
            <Card key={o.number} style={[styles.card, styles.over]}>
              <Text style={styles.name}>{requestLabel(o.number)}</Text>
              <Text style={[styles.meta, styles.bad]}>
                факт {formatMinutes(o.spent_minutes)} при плане {formatPlan(o.plan_minutes)}
              </Text>
              <Text style={styles.meta}>
                {o.state === 'done' ? 'выполнена' : 'не закончена'} · {formatDate(o.since)} — {formatDate(o.last_date)}
              </Text>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { gap: 4, backgroundColor: colors.black },
  totalLabel: { fontSize: font.small, color: '#BBBBBB' },
  totalSum: { fontSize: 34, fontWeight: '800', color: colors.brand },
  totalMeta: { fontSize: font.small, color: '#FFFFFF' },
  warn: { fontWeight: '800', color: colors.brand },
  section: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 8 },
  card: { gap: 6 },
  over: { borderWidth: 3, borderColor: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  name: { fontSize: font.body, fontWeight: '700' },
  ratio: { fontSize: font.body, fontWeight: '800' },
  good: { color: colors.success },
  bad: { color: colors.danger },
  meta: { fontSize: font.small, color: colors.muted },
  barBg: { height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5, backgroundColor: colors.brand },
});
