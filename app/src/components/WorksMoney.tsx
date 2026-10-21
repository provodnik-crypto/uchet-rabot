import { StyleSheet, View } from 'react-native';
import { formatDate } from '../lib/dates';
import { formatKop } from '../lib/money';
import { requestMoney, type RequestWork } from '../lib/requests';
import { formatQuantity } from '../lib/shift';
import { useFocusQuery } from '../lib/useQuery';
import { colors, font, space, stroke } from '../theme';
import { Section } from './Section';
import { Text } from './Text';

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'работа' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'работы' : 'работ');

/**
 * Работы заявки для руководителя: цена за единицу, сумма работы (цена × количество) и итог по заявке.
 * Цены приходят отдельным запросом (request_money) — мастер их не получает.
 */
export function WorksMoney({ requestId, works }: { requestId: number; works: RequestWork[] }) {
  const key = works.map((w) => `${w.id}:${w.status}:${w.quantity}`).join(',');
  const { data: money, error } = useFocusQuery(() => requestMoney(requestId), { key: `money:${requestId}:${key}`, persist: false });
  const byId = new Map((money?.works ?? []).map((m) => [m.id, m]));
  if (!works.length) return null;
  return (
    <Section title={`Работы · ${works.length}`}>
      {works.map((w, i) => {
        const m = w.id != null ? byId.get(w.id) : undefined;
        const qty = `${formatQuantity(w.quantity)} ${w.unit}`;
        return (
          <View key={w.id ?? i} style={[styles.row, i > 0 && styles.line]}>
            <Text style={[styles.name, w.status === 'rejected' && styles.struck]}>{w.name}</Text>
            <Text style={styles.meta}>
              {formatDate(w.work_date)}
              {w.performers ? ` · ${w.performers}` : ''}
            </Text>
            {w.status === 'rejected' ? (
              <Text style={styles.bad}>Отклонена — в итог не входит</Text>
            ) : m?.unit_price_kop != null ? (
              <Text style={styles.price}>
                {qty} × {formatKop(m.unit_price_kop)} = <Text style={styles.sum}>{formatKop(m.total_kop)}</Text>
              </Text>
            ) : w.status === 'pending' ? (
              <Text style={styles.bad}>{qty} · ждёт цены (На оценке)</Text>
            ) : (
              <Text style={styles.meta}>{qty}{money ? ' · цены нет' : ''}</Text>
            )}
          </View>
        );
      })}
      <View style={styles.total}>
        <Text style={styles.totalLabel}>Итого по заявке</Text>
        <Text style={styles.totalSum}>{money ? formatKop(money.total_kop) : error ? '—' : '…'}</Text>
      </View>
      {money?.unpriced ? (
        <Text style={styles.bad}>
          Без цены: {money.unpriced} {plural(money.unpriced)} — итог неполный. Цену назначьте в «На оценке».
        </Text>
      ) : null}
      {error && !money ? <Text style={styles.meta}>Цены не загрузились: {error}</Text> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.s2, paddingVertical: space.s10 },
  line: { borderTopWidth: stroke.hair, borderTopColor: colors.border },
  name: { fontSize: font.body, fontWeight: '600' },
  struck: { textDecorationLine: 'line-through', color: colors.secondary },
  meta: { fontSize: font.small, color: colors.secondary },
  price: { fontSize: font.list },
  sum: { fontWeight: '700' },
  bad: { fontSize: font.small, fontWeight: '700', color: colors.danger },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.s12,
    borderTopWidth: stroke.outline,
    borderTopColor: colors.black,
    paddingTop: space.s10,
  },
  totalLabel: { fontSize: font.body, fontWeight: '700' },
  totalSum: { fontSize: font.number, fontWeight: '700' },
});
