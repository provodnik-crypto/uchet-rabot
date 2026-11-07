import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../../../components/Text';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { humanError } from '../../../lib/errors';
import { attachCreatedPhotos, myRequests, requestLabel, startPlannedWork } from '../../../lib/requests';
import type { DraftPhoto } from '../../../lib/workPhotos';
import { PhotoPicker } from '../../../components/PhotoPicker';
import { useFocusQuery } from '../../../lib/useQuery';
import { stripContacts } from '../../../lib/itsm';
import { colors, font, space } from '../../../theme';

/**
 * «Работа без заявки» — плановая работа. Создаётся заявка № N, сразу «В работе» у мастера; дальше обычный путь:
 * «+ Добавить работу» → «Отправить на проверку». Пока есть другая заявка в работе — сначала отправьте её.
 */
export default function PlannedWorkScreen() {
  // одна заявка в работе: пока есть активная, новую плановую не начать
  const mineQ = useFocusQuery(myRequests, { key: 'home:mine' });
  const active = mineQ.data?.find((m) => m.status === 'in_work' && m.responsible) ?? null;
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      // телефоны и почты в тексте не храним
      const r = await startPlannedWork(stripContacts(title).trim(), stripContacts(details).trim() || null);
      await attachCreatedPhotos(r.id, r.number, photos, setProgress);
      router.replace({ pathname: '/req/[id]', params: { id: String(r.id) } });
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Screen>
      <Text style={styles.lead}>Для плановых работ, на которые нет заявки: обход, профилактика, мелкий ремонт по поручению.</Text>
      <Card style={styles.card}>
        <Field label="Что за работа" value={title} onChangeText={setTitle} placeholder="Например: профилактика освещения, зал 2" maxLength={200} />
        <Field label="Где, подробности (необязательно)" value={details} onChangeText={setDetails} multiline maxLength={1000} />
        <Text style={styles.label}>Фото (необязательно)</Text>
        <PhotoPicker photos={photos} onChange={setPhotos} buttons />
        <Text style={styles.hint}>Без имён, фамилий и телефонов людей.</Text>
      </Card>
      {progress ? <Text style={styles.hint}>{progress}</Text> : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}
      {active ? (
        <Text style={styles.err}>У вас в работе {requestLabel(active.number)}. Работу без заявки можно начать после её отправки на проверку.</Text>
      ) : null}
      <BigButton title="Начать работу" size="big" loading={busy} disabled={title.trim().length < 3 || !!active} onPress={start} />
      <Text style={styles.hint}>Дальше — как с обычной заявкой: «+ Добавить работу», потом «Отправить на проверку».</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: font.body },
  card: { gap: space.s10 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  hint: { fontSize: font.caption, color: colors.muted },
  err: { color: colors.danger, fontSize: font.body },
});
