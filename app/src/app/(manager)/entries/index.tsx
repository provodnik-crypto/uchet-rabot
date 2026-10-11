import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { PeriodPicker } from '../../../components/PeriodPicker';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { listDepartments, type Department } from '../../../lib/departments';
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
import { formatQuantity, statusLabel } from '../../../lib/shift';
import { colors, font } from '../../../theme';

const STATUSES: (EntryStatus | null)[] = [null, 'priced', 'pending', 'rejected'];

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
            <Text style={styles.label}>Сотрудник</Text>
            <View style={styles.chips}>
              <Chip label="Все" selected={filters.employeeId == null} onPress={() => set({ employeeId: null })} />
              {people.map((p) => (
                <Chip key={p.id} label={p.display_name} selected={filters.employeeId === p.id} onPress={() => set({ employeeId: p.id })} />
              ))}
            </View>
            <Text style={styles.label}>Отдел</Text>
            <View style={styles.chips}>
              <Chip label="Все" selected={filters.departmentId == null} onPress={() => set({ departmentId: null })} />
              {departments.map((d) => (
                <Chip key={d.id} label={d.name} selected={filters.departmentId === d.id} onPress={() => set({ departmentId: d.id })} />
              ))}
            </View>
            <Text style={styles.label}>Статус</Text>
            <View style={styles.chips}>
              {STATUSES.map((s) => (
                <Chip key={s ?? 'all'} label={s ? statusLabel[s] : 'Все'} selected={filters.status === s} onPress={() => set({ status: s })} />
              ))}
            </View>
            <Field label="Заявка" value={filters.request} onChangeText={(t) => set({ request: t })} placeholder="часть номера, например 2283" autoCapitalize="characters" />
            {total != null ? <Text style={styles.count}>Найдено работ: {total}</Text> : null}
            {error ? <StateView loading={false} error={error} onRetry={() => load(0)} /> : null}
          </View>
        }
        renderItem={({ item: r }) => (
          <Card style={styles.card} onPress={() => router.push({ pathname: '/entries/[id]', params: { id: String(r.entry_id), data: JSON.stringify(r) } })}>
            <View style={styles.row}>
              <Text style={styles.date}>{formatDate(r.work_date)}</Text>
              <Text style={[styles.status, r.status !== 'priced' && styles.statusWarn]}>{statusLabel[r.status]}</Text>
            </View>
            <Text style={styles.name}>{r.name}</Text>
            <Text style={styles.meta}>
              {r.request_number ?? 'без заявки'} · {r.department_name}
              {r.is_custom ? ' · вне прайса' : ''}
              {r.is_imported ? ' · из старого файла' : ''}
            </Text>
            <View style={styles.row}>
              <Text style={styles.qty}>
                {formatQuantity(r.quantity)} {r.unit_code} × {formatKop(r.unit_price_kop)}
              </Text>
              <Text style={styles.sum}>{formatKop(r.total_kop)}</Text>
            </View>
            <Text style={styles.meta}>{r.performer_names}</Text>
          </Card>
        )}
        ListEmptyComponent={!loading && !error ? <Text style={styles.count}>Нет работ по этим условиям</Text> : null}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.black} style={{ margin: 16 }} /> : null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  header: { gap: 10, marginBottom: 4 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  count: { color: colors.muted, fontSize: font.small },
  card: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  date: { fontSize: font.small, fontWeight: '700' },
  status: { fontSize: font.small, color: colors.success, fontWeight: '700' },
  statusWarn: { color: colors.danger },
  name: { fontSize: font.body, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.muted },
  qty: { fontSize: font.small, flex: 1 },
  sum: { fontSize: font.body, fontWeight: '800' },
});
