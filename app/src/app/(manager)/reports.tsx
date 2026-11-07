import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { PhotoStrip } from '../../components/PhotoStrip';
import { Screen } from '../../components/Screen';
import { StateView } from '../../components/StateView';
import { humanError } from '../../lib/errors';
import { decideMasterReport, formatStoreTime, listMasterReports, reportStatusText, requestLabel, type MasterReport } from '../../lib/requests';
import { useFocusQuery } from '../../lib/useQuery';
import { settleBeforeLeaving } from '../../lib/settle';
import type { RemotePhoto } from '../../lib/workPhotos';
import { colors, font, space, stroke } from '../../theme';

/**
 * Сообщения мастеров: «работы нет в заявках» — создать заявку или отклонить с причиной;
 * просьба «Передать подрядчику» по заявке — передать или не передавать (с причиной). Открыли — «прочитано».
 */
export default function ReportsScreen() {
  const query = useFocusQuery(
    async () => {
      const list = await listMasterReports(true);
      // открыл список — новые сообщения прочитаны (мастер увидит «Руководитель прочитал»)
      await Promise.all(list.filter((m) => m.status === 'new').map((m) => decideMasterReport(m.id, 'read').catch(() => null)));
      return list;
    },
    { key: 'master-reports', persist: false },
  );
  const { data: list, error, loading, reload } = query;
  return (
    <Screen status={query}>
      {!list ? <StateView loading={loading} error={error} onRetry={reload} /> : null}
      {list && !list.length ? <Text style={styles.meta}>Сообщений нет.</Text> : null}
      {list?.map((m) => <ReportCard key={m.id} m={m} onDone={reload} />)}
    </Screen>
  );
}

function ReportCard({ m, onDone }: { m: MasterReport; onDone: () => void }) {
  const [mode, setMode] = useState<null | 'request' | 'reject'>(null);
  const [title, setTitle] = useState(m.text.slice(0, 120));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = m.status === 'new' || m.status === 'read';

  const ask = m.about_request != null;
  // просьба закрыть заявку (мастер: «Не могу выполнить» → «Заявка не нужна»)
  const close = m.kind === 'close';
  async function act(action: 'request' | 'reject' | 'contractor' | 'close') {
    setBusy(true);
    setErr(null);
    try {
      if ((action === 'contractor' || action === 'close') && m.about_request != null &&
          !(await settleBeforeLeaving(m.about_request, action === 'close' ? 'Закрыть заявку' : 'Передать подрядчику'))) return;
      const r = await decideMasterReport(m.id, action, action === 'reject' ? reason.trim() : null, action === 'request' ? title.trim() : null);
      if (action === 'request' && r) router.push({ pathname: '/requests/[id]', params: { id: String(r.id), number: r.number } });
      onDone();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={[styles.card, open && styles.open]}>
      <Text style={styles.meta}>
        {m.author} · {formatStoreTime(m.created_at)}
      </Text>
      {ask ? (
        <Text
          style={styles.ask}
          onPress={() => router.push({ pathname: '/requests/[id]', params: { id: String(m.about_request), number: m.about_number ?? '' } })}
        >
          {close ? 'Просит закрыть заявку (не нужна)' : 'Просит передать подрядчику'} {requestLabel(m.about_number)} →
        </Text>
      ) : null}
      <Text style={styles.text}>{ask ? `Причина: ${m.text}` : m.text}</Text>
      <PhotoStrip photos={m.photos as unknown as RemotePhoto[]} />
      {!open ? (
        <Text style={[styles.status, m.status === 'rejected' && styles.bad]}>
          {m.status === 'request' && m.request_number
            ? `Создана заявка ${requestLabel(m.request_number)}`
            : m.status === 'contractor'
              ? `${requestLabel(m.about_number)} передана подрядчику`
              : m.status === 'closed'
                ? `${requestLabel(m.about_number)} закрыта`
              : reportStatusText[m.status]}
          {m.answer ? ` · ${m.answer}` : ''}
        </Text>
      ) : mode === 'request' ? (
        <View style={styles.card}>
          <Field label="Что нужно сделать (заголовок заявки)" value={title} onChangeText={setTitle} maxLength={200} />
          <BigButton title="Создать заявку" loading={busy} disabled={title.trim().length < 3} onPress={() => act('request')} />
          <BigButton title="Отмена" variant="secondary" onPress={() => setMode(null)} />
        </View>
      ) : mode === 'reject' ? (
        <View style={styles.card}>
          <Field label="Причина — её увидит мастер" value={reason} onChangeText={setReason} multiline placeholder={close ? 'Например: заявка нужна, материалы закажем' : 'Например: уже передали подрядчику'} />
          <BigButton title={close ? 'Не закрывать' : ask ? 'Не передавать' : 'Отклонить'} variant="danger" loading={busy} disabled={reason.trim().length < 3} onPress={() => act('reject')} />
          <BigButton title="Отмена" variant="secondary" onPress={() => setMode(null)} />
        </View>
      ) : close ? (
        <View style={styles.card}>
          <BigButton title="Закрыть заявку" loading={busy} onPress={() => act('close')} />
          <BigButton title="Не закрывать" size="small" variant="secondary" onPress={() => setMode('reject')} />
        </View>
      ) : ask ? (
        <View style={styles.card}>
          <BigButton title="Передать подрядчику" loading={busy} onPress={() => act('contractor')} />
          <BigButton title="Не передавать" size="small" variant="secondary" onPress={() => setMode('reject')} />
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.flex}>
            <BigButton title="Создать заявку" size="small" onPress={() => setMode('request')} />
          </View>
          <View style={styles.flex}>
            <BigButton title="Отклонить" size="small" variant="secondary" onPress={() => setMode('reject')} />
          </View>
        </View>
      )}
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s8 },
  open: { borderWidth: stroke.outline, borderColor: colors.brand },
  row: { flexDirection: 'row', gap: space.s8 },
  flex: { flex: 1 },
  text: { fontSize: font.body },
  ask: { fontSize: font.body, fontWeight: '700', color: colors.violet },
  meta: { fontSize: font.small, color: colors.muted },
  status: { fontSize: font.small, fontWeight: '800', color: colors.success },
  bad: { color: colors.danger },
  err: { color: colors.danger, fontSize: font.small },
});
