import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { BigButton } from './BigButton';
import { Card } from './Card';
import { Field } from './Field';
import { Screen } from './Screen';
import { Text } from './Text';
import { submitDeveloperFeedback } from '../lib/feedback';
import { humanError } from '../lib/errors';
import { colors, font, space } from '../theme';

/** Форма «Написать разработчику»: общая для МВСО, мастера и инициатора (обёртки в каждой группе). */
export function FeedbackForm() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await submitDeveloperFeedback(text);
      router.back();
    } catch (e) {
      setError(humanError(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.note}>
          Сообщение увидит только разработчик. Опишите, что улучшить или что не работает.
        </Text>
        <Field
          label="Сообщение"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
          placeholder="Например: не хватает фильтра по датам в истории"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
      <View>
        <BigButton
          title="Отправить"
          onPress={send}
          loading={busy}
          disabled={busy || text.trim().length < 3}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s12 },
  note: { fontSize: font.small, color: colors.muted },
  error: { color: colors.danger, fontSize: font.body },
});
