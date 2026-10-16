import { router, useFocusEffect } from 'expo-router';
import { requestLabel } from '../../../lib/requests';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../components/Avatar';
import { Card } from '../../../components/Card';
import { FilterSelect } from '../../../components/FilterSelect';
import { SearchBox } from '../../../components/SearchBox';
import { PeriodPicker } from '../../../components/PeriodPicker';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { isWholeStore, listDepartments, type Department } from '../../../lib/departments';
import { humanError } from '../../../lib/errors';
import {
  adminEntries,
  listPerformers,
  presetPeriod,
  type AdminEntry,
  type EntryFilters,
  type EntryStatus,
  type PeriodPreset,
} from '../../../lib/manager';
import { formatKop } from '../../../lib/money';
import { useEmployeeIcons } from '../../../lib/employeeIcons';
import { formatQuantity, statusLabel } from '../../../lib/shift';
import { colors, font } from '../../../theme';

const STATUSES: EntryStatus[] = ['priced', 'awaiting', 'pending', 'rejected'];
const pill = StyleSheet.create({ priced: { backgroundColor: '#E0EDE9' }, pending: { backgroundColor: '#FFF3C4' }, rejected: { backgroundColor: '#F7DCD5' }, awaiting: { backgroundColor: '#E8E4F3' } });
const dot = StyleSheet.create({ priced: { backgroundColor: colors.success }, pending: { backgroundColor: '#BE9200' }, rejected: { backgroundColor: colors.danger }, awaiting: { backgroundColor: '#5E35B1' } });

export default function EntriesScreen() {
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [filters, setFilters] = useState<EntryFilters>({
    period: presetPeriod('month'),
    employeeId: null,
    departmentId: null,
    request: '',
    status: null,
  });
  const [people, setPeople] = useState<{ id: number; display_name: string }[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rows, setRows] = useState<AdminEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const icons = useEmployeeIcons();

  useEffect(() => {
    listPerformers().then(setPeople).catch(() => {});
    listDepartments().then(setDepartments).catch(() => {});
  }, []);

  const load = useCallback(
    async (offset: number) => {
      const my = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const r = await adminEntries(filters, offset);
        if (my !== reqId.current) return;
        setRows((prev) => (offset === 0 ? r : [...prev, ...r]));
        if (offset === 0) setTotal(r[0]?.total_rows ?? 0);
      } catch (e) {
        if (my === reqId.current) setError(humanError(e));
      } finally {
        if (my === reqId.current) setLoading(false);
      }
    },
    [filters],
  );

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const t = setTimeout(() => loadRef.current(0), filters.request ? 300 : 0);
    return () => clearTimeout(t);
  }, [filters]);

  // после правки записи список обновляется
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

  const set = (patch: Partial<EntryFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const hasMore = total != null && rows.length < total;

  return (
    <Screen scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.entry_id)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasMore && !loading) load(rows.length);
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PeriodPicker preset={preset} period={filters.period} onChange={(p, period) => { setPreset(p); set({ period }); }} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={styles.filtersBox} keyboardShouldPersistTaps="handled">
              <FilterSelect
                label="Сотрудник"
                allLabel="Все сотрудники"
                value={filters.employeeId}
                onChange={(v) => set({ employeeId: v })}
                options={people.map((p) => ({ value: p.id, label: p.display_name, left: <Avatar name={p.display_name} icon={icons[p.id]} size={32} /> }))}
              />
              <FilterSelect
                label="Магазин"
                title="Отдел"
                allLabel="Магазин — все отделы"
                value={filters.departmentId}
                onChange={(v) => set({ departmentId: v })}
                options={departments.filter((d) => !isWholeStore(d)).map((d) => ({ value: d.id, label: d.name }))}
              />
              <FilterSelect
                label="Статус"
                allLabel="Все статусы"
                value={filters.status}
                onChange={(v) => set({ status: v })}
                options={STATUSES.map((s) => ({ value: s, label: statusLabel[s] }))}
              />
            </ScrollView>
            <SearchBox
              label="Номер заявки"
              value={filters.request}
              onChangeText={(t) => set({ request: t })}
              placeholder="Номер заявки, например 2283"
              autoCapitalize="characters"
            />
            {total != null ? <Text style={styles.count}>Найдено работ: {total}</Text> : null}
            {error ? <StateView loading={false} error={error} onRetry={() => load(0)} /> : null}
          </View>
        }
        renderItem={({ item: r }) => (
          <Card style={styles.card} onPress={() => router.push({ pathname: '/entries/[id]', params: { id: String(r.entry_id), data: JSON.stringify(r) } })}>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={2}>
                {r.name}
              </Text>
              <Text style={styles.sum}>{formatKop(r.total_kop)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.meta} numberOfLines={1}>
                {formatDate(r.work_date)} · {r.request_number ? requestLabel(r.request_number) : 'без заявки'} · {r.department_name}
                {r.is_custom ? ' · вне прайса' : ''}
                {r.is_imported ? ' · из старого файла' : ''}
              </Text>
              <Text style={styles.qty}>
                {formatQuantity(r.quantity)} {r.unit_code} × {formatKop(r.unit_price_kop)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.people} numberOfLines={1}>
                {r.performer_names}
              </Text>
              <View style={[styles.pill, pill[r.status]]}>
                <View style={[styles.dot, dot[r.status]]} />
                <Text style={styles.pillText}>{statusLabel[r.status]}</Text>
              </View>
            </View>
          </Card>
        )}
        ListEmptyComponent={!loading && !error ? <Text style={styles.count}>Нет работ по этим условиям</Text> : null}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.black} style={{ margin: 16 }} /> : null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 12, gap: 6, paddingBottom: 32 },
  header: { gap: 8, marginBottom: 2 },
  filtersBox: { marginHorizontal: -16 },
  filters: { gap: 6, paddingHorizontal: 16, paddingVertical: 2 },
  count: { color: colors.secondary, fontSize: font.small - 1, paddingHorizontal: 2 },
  card: { gap: 5, paddingVertical: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: font.body, fontWeight: '600' },
  sum: { fontSize: font.body, fontWeight: '700' },
  meta: { flex: 1, fontSize: font.small, color: colors.secondary },
  qty: { fontSize: font.small, color: colors.secondary },
  people: { flex: 1, fontSize: font.small },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 8, borderRadius: 11 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: font.small - 1, fontWeight: '600', color: colors.text },
});
