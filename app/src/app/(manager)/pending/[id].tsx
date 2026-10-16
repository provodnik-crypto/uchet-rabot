import { router, useLocalSearchParams } from 'expo-router';
import { requestLabel } from '../../../lib/requests';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { PhotoStrip } from '../../../components/PhotoStrip';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { pendingQueue, pricePendingEntry, rejectEntry, replaceEntryWithItem } from '../../../lib/manager';
import { formatKop, parseRubToKop } from '../../../lib/money';
import { formatQuantity, parseQuantity, searchWork, type WorkItem } from '../../../lib/shift';
import { TourTarget } from '../../../lib/tour';
import { useFocusQuery } from '../../../lib/useQuery';
import { fetchEntryPhotos, type RemotePhoto } from '../../../lib/workPhotos';
import { colors, font } from '../../../theme';

type Mode = 'price' | 'replace' | 'reject';

export default function PendingEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = Number(id);
  const { data, error, loading, reload } = useFocusQuery(async () => (await pendingQueue()).find((r) => r.entry_id === entryId) ?? null);
  const { data: photos } = useFocusQuery(async () => (await fetchEntryPhotos([entryId]).catch((): Record<number, RemotePhoto[]> => ({})))[entryId] ?? []);

  const [mode, setMode] = useState<Mode>('price');
  const [price, setPrice] = useState('');
  const [addToPrice, setAddToPrice] = useState(false);
  const [comment, setComment] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<WorkItem[]>([]);
  const [item, setItem] = useState<WorkItem | null>(null);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (data?.hint_price_kop && !price) setPrice((data.hint_price_kop / 100).toString().replace('.', ','));
    if (data && !q) setQ(data.custom_name);
  }, [data]);

  useEffect(() => {
    if (mode !== 'replace' || q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => searchWork(q, null, null, 20).then(setFound).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q, mode]);

  if (data === null && !loading && !error) {
    return (
      <Screen>
        <Text style={styles.meta}>Эта работа уже обработана.</Text>
        <BigButton title="К очереди" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <StateView loading={loading} error={error} onRetry={reload} />
      </Screen>
    );
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      router.back();
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  const priceKop = parseRubToKop(price);
  const qtyNum = Number(data.quantity);
  const sameUnit = item ? item.unit_id === data.unit_id : true;

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.name}>{data.custom_name}</Text>
        <Text style={styles.qty}>
          {formatQuantity(data.quantity)} {data.unit_code}
        </Text>
        <Text style={styles.meta}>
          {formatDate(data.work_date)} · {data.request_number ? requestLabel(data.request_number) : 'без заявки'} · {data.department_name}
        </Text>
        <Text style={styles.meta}>
          Исполнители: {data.performer_names} · внёс {data.author_name}
        </Text>
        {data.note ? <Text style={styles.meta}>Примечание: {data.note}</Text> : null}
        {photos?.length ? <PhotoStrip photos={photos} /> : <Text style={styles.meta}>Фото не приложены</Text>}
      </Card>

      <TourTarget id="pdetail.modes">
      <View style={styles.chips}>
        <Chip label="Назначить цену" selected={mode === 'price'} onPress={() => setMode('price')} />
        <Chip label="Заменить на прайс" selected={mode === 'replace'} onPress={() => setMode('replace')} />
        <Chip label="Отклонить" selected={mode === 'reject'} onPress={() => setMode('reject')} />
      </View>
      </TourTarget>
      <TourTarget id="pdetail.action">

      {mode === 'price' ? (
        <Card style={styles.card}>
          {data.hint_price_kop ? (
            <Text style={styles.hint}>
              Такую работу уже оценивали {data.hint_date ? formatDate(data.hint_date) : ''}: {formatKop(data.hint_price_kop)} за {data.unit_code}
            </Text>
          ) : null}
          <Field label={`Цена за ${data.unit_code}, ₽`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="например 500" />
          {priceKop ? (
            <Text style={styles.total}>
              Итого: {formatKop(Math.max(1, Math.round(qtyNum * priceKop)))}
            </Text>
          ) : null}
          <Pressable style={styles.check} onPress={() => setAddToPrice((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: addToPrice }}>
            <View style={[styles.box, addToPrice && styles.boxOn]}>{addToPrice ? <Text style={styles.tick}>✓</Text> : null}</View>
            <Text style={styles.checkText}>Добавить в прайс (категория «Добавлено вручную»), чтобы в следующий раз выбирали из списка</Text>
          </Pressable>
          <BigButton
            title="Назначить цену"
            disabled={!priceKop}
            loading={busy}
            onPress={() => run(() => pricePendingEntry(data.entry_id, priceKop!, addToPrice))}
          />
        </Card>
      ) : null}

      {mode === 'replace' ? (
        <Card style={styles.card}>
          <Field label="Найти позицию прайса" value={q} onChangeText={(t) => { setQ(t); setItem(null); }} autoCorrect={false} />
          {item ? (
            <View style={styles.picked}>
              <Text style={styles.name}>{item.short_name}</Text>
              <Text style={styles.meta}>{[item.category, item.subcategory].filter(Boolean).join(' · ')} · {item.unit_code}</Text>
            </View>
          ) : (
            found.map((w) => (
              <Pressable key={w.id} style={styles.found} onPress={() => setItem(w)}>
                <Text style={styles.foundName}>{w.short_name}</Text>
                <Text style={styles.meta}>{w.category} · {w.unit_code}</Text>
              </Pressable>
            ))
          )}
          {item && !sameUnit ? (
            <Field
              label={`Единица другая — объём в ${item.unit_code}`}
              value={qty}
              onChangeText={setQty}
              keyboardType={item.integer_only ? 'number-pad' : 'decimal-pad'}
            />
          ) : null}
          <BigButton
            title="Заменить"
            disabled={!item}
            loading={busy}
            onPress={() => {
              if (!item) return;
              if (!sameUnit) {
                const p = parseQuantity(qty, item.integer_only);
                if (p.error) return setMessage(p.error);
                return run(() => replaceEntryWithItem(data.entry_id, item.id, p.value));
              }
              run(() => replaceEntryWithItem(data.entry_id, item.id, null));
            }}
          />
          <Text style={styles.meta}>Цена подставится из прайса на дату работы.</Text>
        </Card>
      ) : null}

      {mode === 'reject' ? (
        <Card style={styles.card}>
          <Field label="Комментарий мастеру" value={comment} onChangeText={setComment} multiline placeholder="Что исправить" />
          <BigButton title="Отклонить" variant="danger" disabled={comment.trim().length < 3} loading={busy} onPress={() => run(() => rejectEntry(data.entry_id, comment))} />
          <Text style={styles.meta}>Мастер увидит комментарий, сможет исправить работу и отправить её снова.</Text>
        </Card>
      ) : null}
      </TourTarget>

      {message ? <Text style={styles.err}>{message}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  name: { fontSize: font.body, fontWeight: '700' },
  qty: { fontSize: font.title, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  hint: { fontSize: font.small, fontWeight: '700', color: colors.success },
  total: { fontSize: font.body, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  check: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 56 },
  box: { width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tick: { fontSize: 20, fontWeight: '800' },
  checkText: { flex: 1, fontSize: font.small },
  picked: { backgroundColor: colors.bg, borderRadius: 12, padding: 12, gap: 2 },
  found: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10, minHeight: 56, justifyContent: 'center' },
  foundName: { fontSize: font.body, fontWeight: '600' },
  err: { color: colors.danger, fontSize: font.body },
});
