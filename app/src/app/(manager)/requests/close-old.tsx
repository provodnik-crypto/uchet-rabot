import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { confirm } from '../../../lib/confirm';
import { formatDate, maskDateInput, parseDate } from '../../../lib/dates';
import { humanError } from '../../../lib/errors';
import { closeOldRequests, formatRegistered, oldOpenRequests, type OldRequest, requestLabel } from '../../../lib/requests';
import { storeToday } from '../../../lib/today';
import { colors, font, space, stroke } from '../../../theme';

/** Дата на n дней раньше сегодняшней (по Тюмени), ГГГГ-ММ-ДД. */
function daysAgo(n: number): string {
  const [y, m, d] = storeToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

const PRESETS = [30, 60, 90];

export default function CloseOldScreen() {
  const [text, setText] = useState(formatDate(daysAgo(30)));
  const [rows, setRows] = useState<OldRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const before = parseDate(text);
  const dateError = !before ? 'Дата в виде ДД.ММ.ГГГГ' : before > storeToday() ? 'Дата не может быть в будущем' : null;

  useEffect(() => {
    if (dateError || !before) {
      setRows(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    oldOpenRequests(before)
      .then((r) => alive && (setRows(r), setError(null)))
      .catch((e) => alive && setError(humanError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [before, dateError, tick]);

  async function closeAll() {
    if (!before || !rows?.length) return;
    const ok = await confirm(
      `Закрыть заявки (${rows.length})?`,
      `Все открытые заявки, зарегистрированные раньше ${formatDate(before)}. Мастера перестанут видеть их в списке. Вернуть любую можно кнопкой «Открыть снова» в карточке заявки.`,
      'Закрыть',
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await closeOldRequests(before));
      setTick((t) => t + 1);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {done != null ? (
        <Card style={styles.done}>
          <Text style={styles.doneText}>Закрыто заявок: {done}</Text>
          <Text style={styles.meta}>Они — в «Заявках» на вкладке «Закрытые».</Text>
        </Card>
      ) : null}
      <Card style={styles.card}>
        <Text style={styles.h}>Закрыть открытые заявки, зарегистрированные раньше</Text>
        <View style={styles.chips}>
          {PRESETS.map((n) => (
            <Chip key={n} label={`старше ${n} дней`} selected={before === daysAgo(n)} onPress={() => (setText(formatDate(daysAgo(n))), setDone(null))} />
          ))}
        </View>
        <Field
          label="Дата"
          value={text}
          onChangeText={(t) => (setText(maskDateInput(t)), setDone(null))}
          placeholder="ДД.ММ.ГГГГ"
          keyboardType="number-pad"
          maxLength={10}
          error={text.length === 10 ? dateError : null}
        />
        <Text style={styles.meta}>Закрываются только заявки из ITSM. Работы по ним сохраняются.</Text>
      </Card>

      {error && (rows || dateError) ? <Text style={styles.err}>{error}</Text> : null}
      {!dateError && !rows ? <StateView loading={loading} error={error} onRetry={() => setTick((t) => t + 1)} /> : null}
      {rows ? (
        rows.length ? (
          <>
            <BigButton title={`Закрыть заявки: ${rows.length}`} variant="danger" loading={busy} onPress={closeAll} />
            <Text style={styles.section}>Будут закрыты</Text>
            {rows.map((r) => (
              <Card key={r.id} style={styles.row}>
                <Text style={styles.number}>{requestLabel(r.number)}</Text>
                {r.operation ? <Text style={styles.meta}>{r.operation}</Text> : null}
                {r.description ? (
                  <Text style={styles.desc} numberOfLines={2}>
                    {r.description}
                  </Text>
                ) : null}
                <Text style={styles.meta}>{formatRegistered(r.registered_at)}</Text>
              </Card>
            ))}
          </>
        ) : (
          <Text style={styles.meta}>Открытых заявок раньше этой даты нет.</Text>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s10 },
  h: { fontSize: font.body, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s6 },
  meta: { fontSize: font.small, color: colors.secondary },
  err: { color: colors.danger, fontSize: font.body },
  section: { fontSize: font.small, fontWeight: '700', color: colors.secondary, marginBottom: -space.s4 },
  row: { gap: space.s2 },
  number: { fontSize: font.body, fontWeight: '800' },
  desc: { fontSize: font.body },
  done: { gap: space.s4, borderWidth: stroke.outline, borderColor: colors.success },
  doneText: { fontSize: font.title, fontWeight: '800', color: colors.success },
});
