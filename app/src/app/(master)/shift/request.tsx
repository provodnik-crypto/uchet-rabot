import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { useDraft } from '../../../lib/draft';
import { formatRequestDigits, myRecentRequests, requestError, requestNumber, type RequestPrefix } from '../../../lib/shift';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

export default function RequestScreen() {
  const { draft, setRequest } = useDraft();
  const { data: recent } = useFocusQuery(myRecentRequests);
  const [prefix, setPrefix] = useState<RequestPrefix>('RFS');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Номера, уже добавленные в эту смену, — первыми.
  const inShift = Array.from(
    new Set([...(draft?.requests ?? []).map((r) => r.number), ...(draft?.entries ?? []).map((e) => e.requestNumber)].filter((n): n is string => !!n)),
  );
  const chips = Array.from(new Set([...inShift, ...(recent ?? [])])).slice(0, 8);

  const choose = (number: string | null) => {
    setRequest(number);
    router.replace('/shift/work');
  };

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.h}>Номер заявки</Text>
        <Segmented<RequestPrefix>
          options={[
            { value: 'RFS', label: 'RFS' },
            { value: 'INC', label: 'INC' },
          ]}
          value={prefix}
          onChange={setPrefix}
        />
        <Field
          label={`Цифры номера: ${prefix}${formatRequestDigits(digits) || '______ ____'}`}
          value={formatRequestDigits(digits)}
          onChangeText={(t) => {
            setDigits(t.replace(/\D/g, '').slice(0, 10));
            setError(null);
          }}
          keyboardType="number-pad"
          placeholder="260423_2283"
          maxLength={11}
          error={error}
          hint="Наберите 10 цифр — подчёркивание поставится само"
          autoFocus={chips.length === 0}
        />
        <BigButton
          title="Дальше"
          onPress={() => {
            const e = requestError(digits);
            setError(e);
            if (!e) choose(requestNumber(prefix, digits));
          }}
        />
      </Card>

      {chips.length ? (
        <>
          <Text style={styles.section}>Недавние заявки</Text>
          <View style={styles.wrap}>
            {chips.map((n) => (
              <Chip key={n} label={n} onPress={() => choose(n)} />
            ))}
          </View>
        </>
      ) : null}

      <BigButton title="Без заявки (плановые работы)" variant="secondary" onPress={() => choose(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  h: { fontSize: font.body, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  section: { fontSize: font.small, fontWeight: '700', color: colors.secondary, marginBottom: -4 },
});
