import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { humanError } from '../../../lib/errors';
import { formatKop } from '../../../lib/money';
import { adminPriceItems, PAGE_SIZE, priceFilterLabel, type AdminPriceItem, type PriceFilter } from '../../../lib/price';
import { colors, font } from '../../../theme';

const FILTERS: PriceFilter[] = ['active', 'inactive', 'material', 'all'];

export default function PriceScreen() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<PriceFilter>('active');
  const [items, setItems] = useState<AdminPriceItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const my = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const rows = await adminPriceItems(q, filter, offset);
        if (my !== requestId.current) return; // пришёл ответ на устаревший запрос
        setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]));
        setTotal(rows[0]?.total ?? (offset === 0 ? 0 : total));
      } catch (e) {
        if (my === requestId.current) setError(humanError(e));
      } finally {
        if (my === requestId.current) setLoading(false);
      }
    },
    [q, filter, total],
  );

  // Поиск с небольшой задержкой, чтобы не дёргать сервер на каждую букву.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const t = setTimeout(() => loadRef.current(0), 300);
    return () => clearTimeout(t);
  }, [q, filter]);

  // После правки позиции список обновляется при возврате на экран.
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      loadRef.current(0);
    }, []),
  );

  const hasMore = total != null && items.length < total;

  return (
    <Screen scroll={false}>
      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasMore && !loading) load(items.length);
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Field label="Поиск по названию" value={q} onChangeText={setQ} placeholder="Например, розетка" autoCorrect={false} />
            <View style={styles.chips}>
              {FILTERS.map((f) => (
                <Chip key={f} label={priceFilterLabel[f]} selected={filter === f} onPress={() => setFilter(f)} />
              ))}
            </View>
            {total != null ? (
              <Text style={styles.count}>
                Найдено: {total}
                {hasMore ? ` · показаны первые ${items.length}` : ''}
              </Text>
            ) : null}
            {error ? <StateView loading={false} error={error} onRetry={() => load(0)} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push({ pathname: '/price/[id]', params: { id: String(item.id) } })} style={styles.card}>
            <Text style={[styles.name, !item.is_active && styles.off]}>{item.short_name}</Text>
            <Text style={styles.cat} numberOfLines={1}>
              {[item.category, item.subcategory].filter(Boolean).join(' · ')}
            </Text>
            <View style={styles.row}>
              <Text style={styles.price}>
                {formatKop(item.price_kop)} / {item.unit_code}
              </Text>
              <Text style={styles.status}>
                {item.is_material ? 'материал' : item.is_active ? '' : 'выключена'}
                {item.origin === 'manual' ? ' добавлена вручную' : ''}
              </Text>
            </View>
          </Card>
        )}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.black} style={{ margin: 16 }} /> : null}
        ListEmptyComponent={!loading && !error ? <Text style={styles.count}>Ничего не найдено</Text> : null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  header: { gap: 12, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  count: { color: colors.muted, fontSize: font.small },
  card: { gap: 4 },
  name: { fontSize: font.body, fontWeight: '700' },
  off: { color: colors.muted },
  cat: { fontSize: font.small, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  price: { fontSize: font.body, fontWeight: '600' },
  status: { fontSize: font.small, color: colors.muted },
});
