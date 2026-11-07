import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../../components/Text';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { PeriodPicker } from '../../components/PeriodPicker';
import { Screen } from '../../components/Screen';
import { humanError } from '../../lib/errors';
import { exportExcel } from '../../lib/excel';
import { presetPeriod, type PeriodPreset } from '../../lib/manager';
import { formatKop } from '../../lib/money';
import { colors, font, space } from '../../theme';

export default function ExportScreen() {
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [period, setPeriod] = useState(presetPeriod('month'));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const r = await exportExcel(period);
      setResult({
        ok: true,
        text: `Готово: ${r.fileName}. Итого ${formatKop(r.totalKop)}.${r.pending ? ` Без цены (не вошли): ${r.pending}.` : ''}`,
      });
    } catch (e) {
      setResult({ ok: false, text: humanError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <PeriodPicker preset={preset} period={period} onChange={(p, per) => { setPreset(p); setPeriod(per); setResult(null); }} />
      <Card style={styles.card}>
        <Text style={styles.h}>В файле четыре листа</Text>
        <Text style={styles.item}>• Сотрудники — выработка и диаграмма</Text>
        <Text style={styles.item}>• Итого за месяц — суммы и диаграммы по месяцам</Text>
        <Text style={styles.item}>• Основной подсчет — все работы, по строке на исполнителя</Text>
        <Text style={styles.item}>• По видам работ — объёмы и суммы по работам и категориям</Text>
        <Text style={styles.meta}>Только работы с ценой. Работы «На оценке» в файл не попадают.</Text>
      </Card>
      <BigButton title="Выгрузить в Excel" size="big" loading={busy} onPress={run} />
      {result ? <Text style={[styles.msg, { color: result.ok ? colors.success : colors.danger }]}>{result.text}</Text> : null}
      <Text style={styles.meta}>Файл откроется в меню «Поделиться»: можно отправить в мессенджер, на почту или сохранить.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s6 },
  h: { fontSize: font.body, fontWeight: '700' },
  item: { fontSize: font.small },
  meta: { fontSize: font.small, color: colors.muted },
  msg: { fontSize: font.body },
});
