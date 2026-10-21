import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import { Avatar } from '../../components/Avatar';
import { Card } from '../../components/Card';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { awaitingTotals, monthName, presetPeriod, reportByEmployee, reportByMonth, reportTotals, type PeriodPreset } from '../../lib/manager';
import { formatKop } from '../../lib/money';
import { useEmployeeIcons } from '../../lib/employeeIcons';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font, radius, size, space } from '../../theme';

export default function SummaryScreen() {
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [period, setPeriod] = useState(presetPeriod('month'));
  const icons = useEmployeeIcons();
  // смена периода меняет ключ — данные грузятся заново
  const query = useFocusQuery(
    async () => {
      const [totals, employees, months, awaiting] = await Promise.all([
        reportTotals(period),
        reportByEmployee(period),
        reportByMonth(period),
        awaitingTotals(period).catch(() => null),
      ]);
      return { totals, employees, months, awaiting };
    },
    { key: `summary:${period.from}:${period.to}` },
  );
  const { data, error, loading, reload } = query;

  const maxMonth = Math.max(1, ...(data?.months.map((m) => m.total_kop) ?? [1]));
  const maxEmp = Math.max(1, ...(data?.employees.map((m) => m.total_kop) ?? [1]));

  return (
    <Screen status={query}>
      <PeriodPicker preset={preset} period={period} onChange={(p, per) => { setPreset(p); setPeriod(per); }} />
      {!data ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <Card style={styles.total}>
            <Text style={styles.totalLabel}>Выполнено работ на сумму</Text>
            <Text style={styles.totalSum}>{formatKop(data.totals.total_kop)}</Text>
            <Text style={styles.totalMeta}>работ с ценой: {data.totals.entries}</Text>
            {data.totals.pending ? <Text style={styles.warn}>Без цены (на оценке): {data.totals.pending} — в сумму не входят</Text> : null}
            {data.awaiting?.entries ? (
              <Text style={styles.warn}>
                Ждут приёмки: {data.awaiting.entries} на {formatKop(data.awaiting.total_kop)} — войдут в сумму, когда заявки примут
              </Text>
            ) : null}
            {data.totals.rejected ? <Text style={styles.totalMeta}>Отклонено: {data.totals.rejected}</Text> : null}
          </Card>

          <Text style={styles.section}>По сотрудникам</Text>
          {data.employees.length === 0 ? <Text style={styles.meta}>Нет оценённых работ за период</Text> : null}
          {data.employees.map((e) => (
            <Card key={e.employee_id} style={styles.card}>
              <View style={styles.row}>
                <Avatar name={e.display_name} icon={icons[e.employee_id]} size={size.avatar} />
                <View style={styles.flex}>
                  <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {e.display_name}
                  </Text>
                  <Text style={styles.empSum} numberOfLines={1}>
                    {formatKop(e.total_kop)}
                  </Text>
                </View>
              </View>
              <View style={styles.barBg}>
                <View style={[styles.bar, { width: `${(e.total_kop / maxEmp) * 100}%` }, !e.in_output_chart && styles.barGrey]} />
              </View>
              <Text style={styles.meta}>
                работ: {e.entries} · смен: {e.shifts} · в среднем за смену: {formatKop(Math.round(e.total_kop / Math.max(1, e.shifts)))}
              </Text>
              {!e.in_output_chart ? <Text style={styles.meta}>Служебная запись: работы без исполнителя, в диаграмму выработки не входит</Text> : null}
            </Card>
          ))}
          <Text style={styles.meta}>Если работу делали несколько человек, каждому засчитывается его доля; в общем итоге работа считается один раз.</Text>

          <Text style={styles.section}>По месяцам</Text>
          {data.months.map((m) => (
            <View key={m.month} style={styles.month}>
              <View style={styles.row}>
                <Text style={styles.monthName}>{monthName(m.month)}</Text>
                <Text style={styles.sum}>{formatKop(m.total_kop)}</Text>
              </View>
              <View style={styles.barBg}>
                <View style={[styles.bar, { width: `${(m.total_kop / maxMonth) * 100}%` }]} />
              </View>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { gap: space.s4, backgroundColor: colors.black },
  totalLabel: { fontSize: font.small, color: colors.onDarkMuted },
  totalSum: { fontSize: font.sum, fontWeight: '800', color: colors.brand },
  totalMeta: { fontSize: font.small, color: colors.onDarkMuted },
  warn: { fontSize: font.small, color: colors.white, fontWeight: '700' },
  section: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: space.s8 },
  card: { gap: space.s6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s8 },
  name: { fontSize: font.body, fontWeight: '700' },
  flex: { flex: 1 },
  sum: { fontSize: font.body, fontWeight: '800' },
  empSum: { fontSize: font.title, fontWeight: '800', marginTop: space.s2 },
  meta: { fontSize: font.small, color: colors.muted },
  barBg: { height: size.dot, backgroundColor: colors.bg, borderRadius: radius.tiny, overflow: 'hidden' },
  bar: { height: size.dot, backgroundColor: colors.brand, borderRadius: radius.tiny },
  barGrey: { backgroundColor: colors.border },
  month: { gap: space.s6, backgroundColor: colors.card, borderRadius: radius.card, padding: space.s16 },
  monthName: { fontSize: font.body, fontWeight: '600' },
});
