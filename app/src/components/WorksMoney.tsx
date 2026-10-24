import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatDate } from '../lib/dates';
import { formatKop } from '../lib/money';
import { formatStoreTime, requestMoney, type RequestWork } from '../lib/requests';
import { formatQuantity } from '../lib/shift';
import { useFocusQuery } from '../lib/useQuery';
import { colors, font, iconSize, space, stroke, touch } from '../theme';
import { CorrectWorkSheet, type CorrectTarget } from './CorrectWorkSheet';
import { Icon } from './Icon';
import { Section } from './Section';
import { Text } from './Text';

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'работа' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'работы' : 'работ');

/**
 * Работы заявки для руководителя: цена за единицу, сумма работы (цена × количество) и итог по заявке.
 * Цены приходят отдельным запросом (request_money) — мастер их не получает.
 * ✏️ у работы с ценой — исправить объём и цену (ошибся при оценке), в т. ч. после «Принять».
 */
export function WorksMoney({
  requestId,
  works,
  title = 'Работы',
  unpricedHint = true,
  onChanged,
}: {
  requestId: number;
  works: RequestWork[];
  /** Заголовок над списком, к нему добавляется число работ. */
  title?: string;
  /** Строка «Без цены: N — итог неполный» (на экране оценки заявки не нужна — работы без цены видны выше). */
  unpricedHint?: boolean;
  /** После исправления ✏️ — обновить экран (объём в карточке). */
  onChanged?: () => void;
}) {
  const key = works.map((w) => `${w.id}:${w.status}:${w.quantity}`).join(',');
  const [edit, setEdit] = useState<CorrectTarget | null>(null);
  const { data: money, error, reload } = useFocusQuery(() => requestMoney(requestId), { key: `money:${requestId}:${key}`, persist: false });
  const byId = new Map((money?.works ?? []).map((m) => [m.id, m]));
  if (!works.length) return null;
  return (
    <Section title={`${title} · ${works.length}`}>
      {works.map((w, i) => {
        const m = w.id != null ? byId.get(w.id) : undefined;
        const qty = `${formatQuantity(w.quantity)} ${w.unit}`;
        return (
          <View key={w.id ?? i} style={[styles.row, i > 0 && styles.line]}>
            <View style={styles.head}>
              <Text style={[styles.name, styles.flex, w.status === 'rejected' && styles.struck]}>{w.name}</Text>
              {w.id != null && w.status !== 'rejected' && m?.unit_price_kop != null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Исправить объём и цену"
                  hitSlop={space.s8}
                  onPress={() =>
                    setEdit({ id: w.id!, name: w.name, unit: w.unit, integerOnly: !!w.integer_only, quantity: w.quantity, unitPriceKop: m.unit_price_kop! })
                  }
                  style={({ pressed }) => [styles.pen, pressed && styles.penPressed]}
                >
                  <Icon name="edit" size={iconSize.medium} />
                </Pressable>
              ) : null}
            </View>
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
            {m?.corrected_at && w.status !== 'rejected' ? <Text style={styles.meta}>Исправлено {formatStoreTime(m.corrected_at)}</Text> : null}
          </View>
        );
      })}
      <View style={styles.total}>
        <Text style={styles.totalLabel}>Итого по заявке</Text>
        <Text style={styles.totalSum}>{money ? formatKop(money.total_kop) : error ? '—' : '…'}</Text>
      </View>
      {unpricedHint && money?.unpriced ? (
        <Text style={styles.bad}>
          Без цены: {money.unpriced} {plural(money.unpriced)} — итог неполный. Цену назначьте в «На оценке».
        </Text>
      ) : null}
      {error && !money ? <Text style={styles.meta}>Цены не загрузились: {error}</Text> : null}
      <CorrectWorkSheet
        target={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          reload();
          onChanged?.();
        }}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.s2, paddingVertical: space.s10 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s8 },
  flex: { flex: 1 },
  pen: { width: touch.tiny, height: touch.tiny, borderRadius: touch.tiny / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  penPressed: { backgroundColor: colors.border },
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
