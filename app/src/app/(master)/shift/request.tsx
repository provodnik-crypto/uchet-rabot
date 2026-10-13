import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { RequestList } from '../../../components/RequestList';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { useDraft } from '../../../lib/draft';
import { formatRequestDigits, requestError, requestNumber, type RequestPrefix } from '../../../lib/shift';
import { TourTarget } from '../../../lib/tour';
import { colors, font } from '../../../theme';

export default function RequestScreen() {
  const { draft, setRequest } = useDraft();
  const [manual, setManual] = useState(false);

  // Номера, уже добавленные в эту смену, — первыми, одним касанием.
  const inShift = Array.from(
    new Set([...(draft?.requests ?? []).map((r) => r.number), ...(draft?.entries ?? []).map((e) => e.requestNumber)].filter((n): n is string => !!n)),
  );

  const choose = (number: string | null) => {
    setRequest(number);
    router.replace('/shift/work');
  };

  return (
    <Screen>
      {inShift.length ? (
        <>
          <Text style={styles.section}>Уже в этой смене</Text>
          <View style={styles.wrap}>
            {inShift.map((n) => (
              <Chip key={n} label={n} onPress={() => choose(n)} />
            ))}
          </View>
        </>
      ) : null}

      <RequestList
        mode="select"
        tourId="request.list"
        onChoose={(r) => choose(r.number)}
        onOpen={(r) => router.push({ pathname: '/req/[id]', params: { id: String(r.id), select: '1' } })}
      />

      <TourTarget id="request.manualOpen">
        {manual ? (
          <ManualNumber onDone={choose} />
        ) : (
          <BigButton title="Нет в списке — ввести номер" variant="secondary" onPress={() => setManual(true)} />
        )}
      </TourTarget>
      <BigButton title="Без заявки (плановые работы)" variant="secondary" onPress={() => choose(null)} />
    </Screen>
  );
}

/** Запасной вариант: номер заявки вручную — RFS/INC и 10 цифр. */
function ManualNumber({ onDone }: { onDone: (number: string) => void }) {
  const [prefix, setPrefix] = useState<RequestPrefix>('RFS');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Card style={styles.manual}>
      <Text style={styles.h}>Номер заявки</Text>
      <Segmented<RequestPrefix>
        options={[
          { value: 'RFS', label: 'RFS' },
          { value: 'INC', label: 'INC' },
        ]}
        value={prefix}
        onChange={setPrefix}
      />
      <TourTarget id="request.digits">
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
          autoFocus
        />
      </TourTarget>
      <TourTarget id="request.next">
        <BigButton
          title="Дальше"
          onPress={() => {
            const e = requestError(digits);
            setError(e);
            if (!e) onDone(requestNumber(prefix, digits));
          }}
        />
      </TourTarget>
    </Card>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: font.small, color: colors.secondary },
  manual: { gap: 10 },
  h: { fontSize: font.body, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  section: { fontSize: font.small, fontWeight: '700', color: colors.secondary, marginBottom: -4 },
});
