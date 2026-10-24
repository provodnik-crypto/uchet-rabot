import { useEffect, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { humanError } from '../lib/errors';
import { adminCorrectEntry } from '../lib/manager';
import { formatKop, parseRubToKop } from '../lib/money';
import { formatQuantity, parseQuantity } from '../lib/shift';
import { colors, font, radius, sheetHandle, space, stroke, touch } from '../theme';
import { BigButton } from './BigButton';
import { Text, TextInput } from './Text';

export type CorrectTarget = { id: number; name: string; unit: string; integerOnly: boolean; quantity: number; unitPriceKop: number };

const total = (qty: number, kop: number) => Math.max(Math.round(qty * kop), 1);
const rub = (kop: number) => (kop / 100).toFixed(2).replace(/\.00$/, '').replace('.', ',');

/**
 * ✏️ «Исправить работу» — шторка снизу у руководителя: объём и цена за единицу, «Было → Станет».
 * Меняется только эта работа (прайс — нет), суммы мастеров пересчитываются; мастер об исправлении не видит.
 */
export function CorrectWorkSheet({ target, onClose, onSaved }: { target: CorrectTarget | null; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets();
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // окно на Android не сжимается — шторку поднимаем над клавиатурой сами
  const [kb, setKb] = useState(0);

  useEffect(() => {
    if (!target) return;
    setQty(formatQuantity(target.quantity));
    setPrice(rub(target.unitPriceKop));
    setErr(null);
  }, [target]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (!target) return null;
  const q = parseQuantity(qty, target.integerOnly);
  const kop = parseRubToKop(price);
  const priceErr = !price.trim() ? 'Введите цену' : kop == null || kop <= 0 ? 'Цена — число, до 2 знаков после запятой' : null;
  const changed = q.value != null && kop != null && (q.value !== target.quantity || kop !== target.unitPriceKop);
  const ok = !q.error && !priceErr;

  async function save() {
    if (!target || q.value == null || kop == null) return;
    setBusy(true);
    setErr(null);
    try {
      await adminCorrectEntry(target.id, q.value, kop);
      Keyboard.dismiss();
      onSaved();
      onClose();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Закрыть" onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: (kb || insets.bottom) + space.s12 }]}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <Text style={styles.title}>Исправить работу</Text>
            <Text style={styles.name}>{target.name}</Text>
            <View style={styles.fields}>
              <View style={styles.field}>
                <Text style={styles.label}>Объём, {target.unit}</Text>
                <TextInput style={[styles.input, q.error && qty ? styles.inputBad : null]} value={qty} onChangeText={setQty} keyboardType="decimal-pad" selectTextOnFocus />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Цена за {target.unit}, ₽</Text>
                <TextInput style={[styles.input, priceErr && price ? styles.inputBad : null]} value={price} onChangeText={setPrice} keyboardType="decimal-pad" selectTextOnFocus />
              </View>
            </View>
            {q.error ? <Text style={styles.bad}>{q.error}</Text> : priceErr ? <Text style={styles.bad}>{priceErr}</Text> : null}
            <Text style={styles.meta}>
              Было: {formatQuantity(target.quantity)} {target.unit} × {formatKop(target.unitPriceKop)} = {formatKop(total(target.quantity, target.unitPriceKop))}
            </Text>
            {ok && q.value != null && kop != null ? (
              <Text style={styles.now}>
                Станет: {formatQuantity(q.value)} {target.unit} × {formatKop(kop)} = {formatKop(total(q.value, kop))}
              </Text>
            ) : null}
            <Text style={styles.meta}>Меняется только эта работа, прайс — нет. Суммы за месяц пересчитаются.</Text>
            {err ? <Text style={styles.bad}>Не сохранено: {err}</Text> : null}
            <BigButton title={err ? 'Повторить' : 'Сохранить'} size="big" loading={busy} disabled={!ok || !changed || busy} onPress={save} />
            <BigButton title="Отмена" variant="secondary" disabled={busy} onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingTop: space.s8, maxHeight: '90%' },
  handle: { width: sheetHandle.width, height: sheetHandle.height, borderRadius: radius.tiny, backgroundColor: colors.handle, alignSelf: 'center', marginBottom: space.s8 },
  body: { paddingHorizontal: space.s20, gap: space.s10 },
  title: { fontSize: font.title, fontWeight: '800' },
  name: { fontSize: font.body, fontWeight: '600' },
  fields: { flexDirection: 'row', gap: space.s12 },
  field: { flex: 1, gap: space.s4 },
  label: { fontSize: font.small, fontWeight: '600', color: colors.secondary },
  input: {
    minHeight: touch.min,
    borderRadius: radius.small,
    borderWidth: stroke.outline,
    borderColor: colors.border,
    paddingHorizontal: space.s12,
    fontSize: font.body,
    color: colors.black,
    backgroundColor: colors.card,
  },
  inputBad: { borderColor: colors.danger },
  meta: { fontSize: font.small, color: colors.secondary },
  now: { fontSize: font.body, fontWeight: '700' },
  bad: { fontSize: font.small, fontWeight: '700', color: colors.danger },
});
