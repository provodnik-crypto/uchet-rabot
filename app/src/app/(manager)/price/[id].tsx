import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { DateField, todayText } from '../../../components/DateField';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { formatDate, parseDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { formatKop, parseRubToKop } from '../../../lib/money';
import { getAdminPriceItem, listUnits, setPrice, updatePriceItem } from '../../../lib/price';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font, space } from '../../../theme';

export default function PriceItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = Number(id);
  const { data, error, loading, reload } = useFocusQuery(async () => {
    const [detail, units] = await Promise.all([getAdminPriceItem(itemId), listUnits()]);
    return { ...detail, units };
  });

  const [shortName, setShortName] = useState('');
  const [price, setPriceText] = useState('');
  const [fromDate, setFromDate] = useState(todayText());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (data) setShortName(data.item.short_name);
  }, [data]);

  async function run(key: string, fn: () => Promise<unknown>, okText: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage({ text: okText, ok: true });
      await reload();
    } catch (e) {
      setMessage({ text: humanError(e), ok: false });
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <Screen>
        <StateView loading={loading} error={error} onRetry={reload} />
      </Screen>
    );
  }

  const { item, history, units } = data;

  function savePrice() {
    const kop = parseRubToKop(price);
    const date = parseDate(fromDate);
    const errs = {
      price: kop && kop > 0 ? null : 'Введите цену в рублях, например 850 или 28,57',
      date: date ? null : 'Дата в виде ДД.ММ.ГГГГ',
    };
    setFieldErrors(errs);
    if (errs.price || errs.date) return;
    run(
      'price',
      async () => {
        await setPrice(item.id, kop!, date);
        setPriceText('');
      },
      `Цена ${formatKop(kop)} действует с ${formatDate(date!)}. Уже внесённые работы не меняются.`,
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Позиция прайса' }} />
      <Card style={styles.card}>
        <Text style={styles.cat}>{[item.category, item.subcategory].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.full}>{item.full_name}</Text>
        <Text style={styles.meta}>
          {item.is_material ? 'Материал — мастерам не показывается' : item.is_active ? 'Активна — мастера её видят' : 'Выключена — мастера её не видят'}
        </Text>
        <Field label="Короткое название (видит мастер)" value={shortName} onChangeText={setShortName} multiline />
        <BigButton
          title="Сохранить название"
          variant="secondary"
          disabled={!shortName.trim() || shortName.trim() === item.short_name}
          loading={busy === 'name'}
          onPress={() => run('name', () => updatePriceItem(item.id, { short_name: shortName.trim() }), 'Название сохранено')}
        />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>Единица измерения</Text>
        <View style={styles.chips}>
          {units.map((u) => (
            <Chip
              key={u.id}
              label={u.code}
              selected={u.id === item.unit_id}
              onPress={() => {
                if (u.id !== item.unit_id) run('unit', () => updatePriceItem(item.id, { unit_id: u.id }), `Единица изменена на «${u.code}»`);
              }}
            />
          ))}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>Цена: {formatKop(item.price_kop)} за {item.unit_code}</Text>
        {item.price_valid_from ? <Text style={styles.meta}>действует с {formatDate(item.price_valid_from)}</Text> : null}
        <Field
          label="Новая цена, ₽"
          value={price}
          onChangeText={setPriceText}
          keyboardType="decimal-pad"
          placeholder="например 850"
          error={fieldErrors.price}
        />
        <DateField
          label="Действует с"
          value={fromDate}
          onChange={setFromDate}
          error={fieldErrors.date}
          hint="По умолчанию сегодня. Можно указать прошедшую или будущую дату."
        />
        <BigButton title="Сохранить цену" loading={busy === 'price'} onPress={savePrice} />
      </Card>

      {message ? <Text style={[styles.msg, { color: message.ok ? colors.success : colors.danger }]}>{message.text}</Text> : null}

      <BigButton
        title={item.is_active ? 'Выключить позицию' : 'Включить позицию'}
        variant={item.is_active ? 'danger' : 'primary'}
        loading={busy === 'active'}
        onPress={() =>
          run(
            'active',
            () => updatePriceItem(item.id, item.is_active ? { is_active: false } : { is_active: true, is_material: false }),
            item.is_active ? 'Позиция выключена' : 'Позиция включена: мастера её видят. Проверьте единицу и цену.',
          )
        }
      />
      {!item.is_material ? (
        <BigButton
          title="Это материал, а не работа"
          variant="secondary"
          loading={busy === 'material'}
          onPress={() => run('material', () => updatePriceItem(item.id, { is_material: true, is_active: false }), 'Отмечено как материал и выключено')}
        />
      ) : null}

      <Card style={styles.card}>
        <Text style={styles.h}>История цен</Text>
        {history.map((h) => (
          <View key={h.id} style={styles.histRow}>
            <Text style={styles.histDate}>с {formatDate(h.valid_from)}</Text>
            <Text style={styles.histPrice}>{formatKop(h.price_kop)}</Text>
            <Text style={styles.meta}>{h.price_list_id ? 'прайс' : 'вручную'}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s12 },
  cat: { fontSize: font.small, color: colors.muted },
  full: { fontSize: font.body, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: font.small },
  h: { fontSize: font.body, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s8 },
  msg: { fontSize: font.body },
  histRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s8 },
  histDate: { fontSize: font.body, flex: 1 },
  histPrice: { fontSize: font.body, fontWeight: '600' },
});
