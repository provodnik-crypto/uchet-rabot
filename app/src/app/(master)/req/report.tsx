import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../../../components/Text';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { PhotoPicker } from '../../../components/PhotoPicker';
import { PhotoStrip } from '../../../components/PhotoStrip';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { humanError } from '../../../lib/errors';
import { stripContacts } from '../../../lib/itsm';
import { createMasterReport, markMyReportsSeen, myMasterReports, reportStatusText, requestLabel, formatStoreTime } from '../../../lib/requests';
import { useFocusQuery } from '../../../lib/useQuery';
import { toPayload, uploadAll, type DraftPhoto, type RemotePhoto } from '../../../lib/workPhotos';
import { colors, font, space, stroke } from '../../../theme';

/**
 * «Сообщить руководителю» — когда работы нет в списке заявок: коротко что случилось и фото.
 * Заявку создаёт руководитель; ниже — мои сообщения и ответы на них.
 */
export default function ReportScreen() {
  const query = useFocusQuery(myMasterReports, { key: 'my-reports', persist: false });
  const { data: list, error, loading, reload } = query;
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // открыли экран — ответы руководителя просмотрены
  useFocusEffect(useCallback(() => void markMyReportsSeen(), []));

  async function send() {
    setBusy(true);
    setErr(null);
    setSent(false);
    try {
      const uploaded = await uploadAll(photos, setProgress);
      setPhotos(uploaded);
      await createMasterReport(stripContacts(text).trim(), toPayload(uploaded));
      setText('');
      setPhotos([]);
      setSent(true);
      reload();
    } catch (e) {
      // текст и фото остаются — можно нажать «Повторить»
      setErr(humanError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Screen status={query}>
      <Text style={styles.lead}>Нашли поломку, а заявки нет? Напишите руководителю — он решит, создавать ли заявку.</Text>
      <Card style={styles.card}>
        <Field label="Что случилось и где" value={text} onChangeText={setText} multiline maxLength={1000} placeholder="Например: течёт кран в подсобке у склада" />
        <Text style={styles.label}>Фото (по желанию, до 3)</Text>
        <PhotoPicker photos={photos} onChange={setPhotos} />
        <Text style={styles.hint}>Без имён, фамилий и телефонов людей.</Text>
      </Card>
      {progress ? <Text style={styles.meta}>{progress}</Text> : null}
      {err ? <Text style={styles.err}>Не отправлено: {err}</Text> : null}
      {sent ? <Text style={styles.ok}>Отправлено руководителю.</Text> : null}
      <BigButton title={err ? 'Повторить' : 'Отправить руководителю'} size="big" loading={busy} disabled={text.trim().length < 3} onPress={send} />

      <Text style={styles.section}>Мои сообщения</Text>
      {!list ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {list && !list.length ? <Text style={styles.meta}>Пока ничего не отправляли.</Text> : null}
      {list?.map((m) => (
        <Card key={m.id} style={[styles.card, m.unseen && styles.fresh]}>
          <Text style={styles.meta}>{formatStoreTime(m.created_at)}</Text>
          <Text style={styles.text}>{m.about_number ? `Просьба передать подрядчику ${requestLabel(m.about_number)}: ${m.text}` : m.text}</Text>
          <PhotoStrip photos={m.photos as unknown as RemotePhoto[]} size="small" />
          <Text style={[styles.status, m.status === 'rejected' && styles.bad, (m.status === 'request' || m.status === 'contractor') && styles.good]}>
            {m.status === 'request' && m.request_number ? `Создана заявка ${requestLabel(m.request_number)}` : reportStatusText[m.status]}
          </Text>
          {m.answer ? <Text style={styles.text}>{m.status === 'rejected' ? 'Причина: ' : 'Ответ: '}{m.answer}</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: font.body },
  card: { gap: space.s8 },
  fresh: { borderWidth: stroke.outline, borderColor: colors.brand },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  section: { fontSize: font.text, fontWeight: '700', marginTop: space.s8 },
  text: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.muted },
  hint: { fontSize: font.caption, color: colors.muted },
  status: { fontSize: font.small, fontWeight: '800', color: colors.secondary },
  bad: { color: colors.danger },
  good: { color: colors.success },
  err: { color: colors.danger, fontSize: font.body },
  ok: { color: colors.success, fontSize: font.body, fontWeight: '700' },
});
