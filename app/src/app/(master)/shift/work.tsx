import { router } from 'expo-router';
import { requestLabel } from '../../../lib/requests';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Icon } from '../../../components/Icon';
import { Screen } from '../../../components/Screen';
import { SearchBox } from '../../../components/SearchBox';
import { Segmented } from '../../../components/Segmented';
import { StateView } from '../../../components/StateView';
import { useDraft } from '../../../lib/draft';
import { humanError } from '../../../lib/errors';
import { previewText, requestCard, type RequestCard } from '../../../lib/requests';
import { myWorkItems, searchWork, workCategories, type CategoryRow, type WorkItem } from '../../../lib/shift';
import { TourTarget } from '../../../lib/tour';
import { colors, font, radius, touch } from '../../../theme';

type Tab = 'frequent' | 'recent' | 'categories';
const tabLabel: Record<Tab, string> = { frequent: 'Часто', recent: 'Недавние', categories: 'Категории' };

type Row = { type: 'item'; item: WorkItem } | { type: 'group'; label: string; count: number; category: string; subcategory?: string | null };

export default function WorkPickerScreen() {
  const { draft } = useDraft();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('frequent');
  const [category, setCategory] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState<string | null | undefined>(undefined);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cats = useRef<CategoryRow[] | null>(null);
  const reqId = useRef(0);

  const searching = q.trim().length > 0;

  // Суть заявки над выбором работы: операция и описание.
  const [info, setInfo] = useState<RequestCard | null>(null);
  const [expanded, setExpanded] = useState(false);
  const currentRequest = draft?.currentRequest;
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setExpanded(false);
    if (currentRequest) requestCard({ number: currentRequest }).then((r) => alive && setInfo(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [currentRequest]);

  useEffect(() => {
    const my = ++reqId.current;
    const run = async (): Promise<Row[]> => {
      if (searching) return (await searchWork(q, null, null, 60)).map((item) => ({ type: 'item', item }));
      if (tab !== 'categories') return (await myWorkItems(tab)).map((item) => ({ type: 'item', item }));
      cats.current ??= await workCategories();
      const all = cats.current;
      if (!category) {
        const byCat = new Map<string, number>();
        for (const c of all) byCat.set(c.category, (byCat.get(c.category) ?? 0) + Number(c.items));
        return [...byCat].map(([label, count]) => ({ type: 'group', label, count, category: label }));
      }
      const subs = all.filter((c) => c.category === category);
      if (subcategory === undefined && subs.length > 1) {
        return subs.map((c) => ({
          type: 'group',
          label: c.subcategory ?? 'Без подкатегории',
          count: Number(c.items),
          category,
          subcategory: c.subcategory,
        }));
      }
      return (await searchWork('', category, subcategory ?? null, 200)).map((item) => ({ type: 'item', item }));
    };
    setLoading(true);
    setError(null);
    const t = setTimeout(
      () =>
        run()
          .then((r) => my === reqId.current && setRows(r))
          .catch((e) => my === reqId.current && setError(humanError(e)))
          .finally(() => my === reqId.current && setLoading(false)),
      searching ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [q, searching, tab, category, subcategory, attempt]);

  const pick = (item: WorkItem) =>
    router.push({
      pathname: '/shift/entry',
      params: {
        itemId: String(item.id),
        name: item.short_name,
        category: [item.category, item.subcategory].filter(Boolean).join(' · '),
        unitId: String(item.unit_id),
        unitCode: item.unit_code,
        integerOnly: item.integer_only ? '1' : '0',
      },
    });

  const notInPrice = () => router.push({ pathname: '/shift/entry', params: { custom: '1', name: q.trim() } });

  const back = () => {
    if (subcategory !== undefined) setSubcategory(undefined);
    else setCategory(null);
  };

  const emptyText = searching
    ? 'В прайсе ничего не нашлось. Нажмите «Работы нет в прайсе».'
    : tab === 'frequent' || tab === 'recent'
      ? 'Здесь появятся работы, которые вы вносили. Найдите работу поиском или в категориях.'
      : 'Нет работ';

  return (
    <Screen scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.type === 'item' ? `i${r.item.id}` : `g${i}${r.label}`)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.request}>
              Заявка: {draft?.currentRequest ? requestLabel(draft.currentRequest) : 'без заявки'}
            </Text>
            {info && (info.operation || info.description) ? (
              <TourTarget id="work.request">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={expanded ? 'Свернуть описание заявки' : 'Показать описание заявки полностью'}
                  onPress={() => setExpanded((e) => !e)}
                  style={styles.reqBox}
                >
                  {info.operation ? <Text style={styles.reqOp}>{info.operation}</Text> : null}
                  {info.description ? (
                    <Text style={styles.reqDesc} numberOfLines={expanded ? undefined : 3} selectable={expanded}>
                      {expanded ? info.description : previewText(info.description)}
                    </Text>
                  ) : null}
                  <Text style={styles.reqMore}>{expanded ? 'Свернуть' : 'Показать полностью'}</Text>
                </Pressable>
              </TourTarget>
            ) : null}
            <TourTarget id="work.search">
              <SearchBox label="Поиск работы" value={q} onChangeText={setQ} placeholder="Поиск работы, например розетка" autoCorrect={false} />
            </TourTarget>
            {!searching ? (
              <Segmented
                options={(Object.keys(tabLabel) as Tab[]).map((t) => ({ value: t, label: tabLabel[t] }))}
                value={tab}
                onChange={(t) => {
                  setTab(t);
                  setCategory(null);
                  setSubcategory(undefined);
                }}
              />
            ) : null}
            {!searching && tab === 'categories' && category ? (
              <Pressable onPress={back} style={styles.crumb}>
                <Text style={styles.crumbText}>
                  ← {category}
                  {subcategory !== undefined ? ` · ${subcategory ?? 'Без подкатегории'}` : ''}
                </Text>
              </Pressable>
            ) : null}
            {error ? <StateView loading={false} error={error} onRetry={() => setAttempt((n) => n + 1)} /> : null}
          </View>
        }
        renderItem={({ item: r }) =>
          r.type === 'item' ? (
            <Card onPress={() => pick(r.item)} style={styles.item}>
              <Text style={styles.name}>{r.item.short_name}</Text>
              <Text style={styles.cat} numberOfLines={1}>
                {[r.item.category, r.item.subcategory].filter(Boolean).join(' · ')} · {r.item.unit_code}
              </Text>
            </Card>
          ) : (
            <Card
              onPress={() => {
                if (!category) setCategory(r.category);
                else setSubcategory(r.subcategory ?? null);
              }}
              style={styles.group}
            >
              <Text style={styles.groupName}>{r.label}</Text>
              <Text style={styles.count}>{r.count}</Text>
              <Icon name="chevronRight" size={16} color={colors.muted} strokeWidth={2.4} />
            </Card>
          )
        }
        ListEmptyComponent={loading ? null : <Text style={styles.empty}>{emptyText}</Text>}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.black} style={{ margin: 16 }} /> : null}
      />
      <View style={styles.bottom}>
        <TourTarget id="work.custom">
          <BigButton title="Работы нет в прайсе" variant="secondary" onPress={notInPrice} />
        </TourTarget>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 12, gap: 6, paddingBottom: 16 },
  header: { gap: 8, marginBottom: 2 },
  request: { fontSize: font.small, color: colors.secondary, fontWeight: '600' },
  reqBox: { backgroundColor: colors.card, borderRadius: radius.card, padding: 10, gap: 2, borderLeftWidth: 3, borderLeftColor: colors.brand },
  reqOp: { fontSize: font.small, fontWeight: '700' },
  reqDesc: { fontSize: font.body },
  reqMore: { fontSize: font.small, color: colors.secondary, fontWeight: '600', marginTop: 2 },
  crumb: { minHeight: 40, justifyContent: 'center' },
  crumbText: { fontSize: font.body, fontWeight: '700' },
  item: { gap: 2, minHeight: touch.min, justifyContent: 'center', paddingVertical: 10 },
  name: { fontSize: font.body, fontWeight: '600' },
  cat: { fontSize: font.small, color: colors.secondary },
  group: { flexDirection: 'row', alignItems: 'center', minHeight: touch.min, gap: 8, paddingVertical: 10 },
  groupName: { fontSize: font.body, fontWeight: '600', flex: 1 },
  count: { fontSize: font.small - 1, color: colors.secondary, backgroundColor: colors.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.chip, overflow: 'hidden' },
  empty: { color: colors.secondary, fontSize: font.body, textAlign: 'center', marginTop: 24 },
  bottom: { padding: 12, paddingHorizontal: 16, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
});
