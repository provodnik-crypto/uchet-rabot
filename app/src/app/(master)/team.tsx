import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Card } from '../../components/Card';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { useAuth } from '../../lib/auth';
import { monthName, presetPeriod, type PeriodPreset } from '../../lib/manager';
import { formatKop } from '../../lib/money';
import { usePhotoUrls } from '../../lib/photos';
import { teamByMonth, teamRating } from '../../lib/shift';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font } from '../../theme';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function TeamScreen() {
  const { me } = useAuth();
  const photos = usePhotoUrls();
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [period, setPeriod] = useState(presetPeriod('month'));
  const { data, error, loading, reload } = useFocusQuery(async () => {
    const [rating, months] = await Promise.all([teamRating(period.from, period.to), teamByMonth(period.from, period.to)]);
    return { rating, months };
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [period.from, period.to, reload]);

  const max = Math.max(1, ...(data?.rating.map((r) => r.total_kop) ?? [1]));
  const monthKeys = [...new Set(data?.months.map((m) => m.month) ?? [])];

  return (
    <Screen>
      <PeriodPicker preset={preset} period={period} onChange={(p, per) => { setPreset(p); setPeriod(per); }} />
      {!data || loading ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {data && !loading ? (
        <>
          <Text style={styles.section}>Рейтинг команды</Text>
          {data.rating.map((r, i) => {
            const mine = r.employee_id === me?.id;
            return (
              <Card key={r.employee_id} style={[styles.card, mine && styles.mine]}>
                <View style={styles.row}>
                  <Text style={styles.place}>{r.total_kop > 0 ? (MEDALS[i] ?? `${i + 1}`) : '–'}</Text>
                  <Avatar name={r.display_name} uri={photos[r.employee_id]} size={44} />
                  <View style={styles.flex}>
                    <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {r.display_name}
                      {mine ? ' (я)' : ''}
                    </Text>
                    <Text style={styles.sum} numberOfLines={1}>
                      {formatKop(r.total_kop)}
                    </Text>
                  </View>
                </View>
                <View style={styles.barBg}>
                  <View style={[styles.bar, { width: `${(r.total_kop / max) * 100}%` }]} />
                </View>
                <Text style={styles.meta}>
                  заявок: {r.requests} · работ: {r.entries}
                </Text>
              </Card>
            );
          })}
          <Text style={styles.meta}>Совместная работа делится поровну между исполнителями. Работы «На оценке» засчитываются после того, как руководитель назначит цену.</Text>

          {monthKeys.length > 1 || preset !== 'month' ? (
            <>
              <Text style={styles.section}>По месяцам</Text>
              {monthKeys.map((m) => {
                const rows = data.months.filter((x) => x.month === m);
                const top = Math.max(1, ...rows.map((x) => x.total_kop));
                return (
                  <Card key={m} style={styles.card}>
                    <Text style={styles.month}>{monthName(m)}</Text>
                    {rows.map((x) => (
                      <View key={x.employee_id} style={styles.monthRow}>
                        <Avatar name={x.display_name} uri={photos[x.employee_id]} size={28} />
                        <View style={styles.flex}>
                          <View style={styles.row}>
                            <Text style={[styles.small, styles.flex, x.employee_id === me?.id && styles.bold]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                              {x.display_name}
                            </Text>
                            <Text style={[styles.small, styles.bold]} numberOfLines={1}>
                              {formatKop(x.total_kop)}
                            </Text>
                          </View>
                          <View style={styles.barBgThin}>
                            <View style={[styles.bar, { width: `${(x.total_kop / top) * 100}%` }]} />
                          </View>
                        </View>
                      </View>
                    ))}
                  </Card>
                );
              })}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 8 },
  card: { gap: 8 },
  mine: { borderWidth: 2, borderColor: colors.brand },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  place: { fontSize: font.title, width: 28, textAlign: 'center', fontWeight: '800' },
  flex: { flex: 1 },
  name: { fontSize: font.body, fontWeight: '700' },
  sum: { fontSize: font.title, fontWeight: '800', marginTop: 2 },
  meta: { fontSize: font.small, color: colors.muted },
  barBg: { height: 10, backgroundColor: colors.bg, borderRadius: 5, overflow: 'hidden' },
  barBgThin: { height: 6, backgroundColor: colors.bg, borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  bar: { height: '100%', backgroundColor: colors.brand, borderRadius: 5 },
  month: { fontSize: font.body, fontWeight: '700', textTransform: 'capitalize' },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  small: { fontSize: font.small },
  bold: { fontWeight: '800' },
});
