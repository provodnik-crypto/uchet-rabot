import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../../../components/Text';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { humanError } from '../../../lib/errors';
import { startPlannedWork } from '../../../lib/requests';
import { stripContacts } from '../../../lib/itsm';
import { colors, font, space } from '../../../theme';

/**
 * «Работа без заявки» — плановая работа. Создаётся заявка № N, сразу «В работе» у мастера; дальше обычный путь:
 * «+ Добавить работу» → «Отправить на проверку». Пока есть другая заявка в работе — сначала отправьте её.
 */
export default function PlannedWorkScreen() {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      // телефоны и почты в тексте не храним
      const r = await startPlannedWork(stripContacts(title).trim(), stripContacts(details).trim() || null);
      router.replace({ pathname: '/req/[id]', params: { id: String(r.id) } });
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.lead}>Для плановых работ, на которые нет заявки: обход, профилактика, мелкий ремонт по поручению.</Text>
      <Card style={styles.card}>
        <Field label="Что за работа" value={title} onChangeText={setTitle} placeholder="Например: профилактика освещения, зал 2" maxLength={200} />
        <Field label="Где, подробности (необязательно)" value={details} onChangeText={setDetails} multiline maxLength={1000} />
        <Text style={styles.hint}>Без имён, фамилий и телефонов людей.</Text>
      </Card>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <BigButton title="Начать работу" size="big" loading={busy} disabled={title.trim().length < 3} onPress={start} />
      <Text style={styles.hint}>Дальше — как с обычной заявкой: «+ Добавить работу», потом «Отправить на проверку».</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: font.body },
  card: { gap: space.s10 },
  hint: { fontSize: font.caption, color: colors.muted },
  err: { color: colors.danger, fontSize: font.body },
});
