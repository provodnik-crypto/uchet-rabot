import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Screen } from '../../../components/Screen';
import { formatDate } from '../../../lib/dates';
import { groupIsSent, shiftGroups, useDraft } from '../../../lib/draft';
import { humanError } from '../../../lib/errors';
import { formatMinutes, SHIFT_MINUTES, statusText } from '../../../lib/requestTime';
import { parseQuantity, submitShift, type SubmitEntry, type SubmitRequest } from '../../../lib/shift';
import { storeToday, storeYesterday } from '../../../lib/today';
import { toPayload, uploadPhotos, type DraftPhoto } from '../../../lib/workPhotos';
import { colors, font } from '../../../theme';

export default function ReviewScreen() {
  const { draft, setWorkDate, clear, upsertEntry } = useDraft();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  if (!draft) {
    return (
      <Screen>
        <BigButton title="На главную" onPress={() => router.dismissAll()} />
      </Screen>
    );
  }
  const groups = shiftGroups(draft).filter(groupIsSent);
  const total = groups.reduce((a, g) => a + (g.time.minutes ?? 0), 0);
  const noTime = groups.filter((g) => !g.time.minutes);
  const today = storeToday();
  const yesterday = storeYesterday();
  const pending = draft.entries.filter((e) => !e.priceItemId).length;

  async function send() {
    if (!draft) return;
    if (noTime.length) {
      setError(`Укажите время: ${noTime.map((g) => g.request ?? 'без заявки').join(', ')}`);
      return;
    }
    setSending(true);
    setError(null);
    try {
      // 1. Фото: загружаем недостающие; путь каждого загруженного сразу сохраняем в черновик,
      //    поэтому при обрыве связи «Повторить» догрузит только оставшиеся.
      const uploaded = new Map<string, DraftPhoto>();
      const all = draft.entries.flatMap((e) => (e.photos ?? []).map((p) => ({ entry: e, photo: p })));
      if (all.some(({ photo }) => !photo.path)) {
        await uploadPhotos(
          all.map((x) => x.photo),
          (p) => {
            uploaded.set(p.key, p);
            const owner = all.find((x) => x.photo.key === p.key)!.entry;
            upsertEntry({ ...owner, photos: (owner.photos ?? []).map((x) => uploaded.get(x.key) ?? x) });
          },
          (done, total) => setProgress(`Загружаем фото: ${done} из ${total}`),
        );
      }
      setProgress('Отправляем смену…');
      const withPhotos = (e: (typeof draft.entries)[number]) => (e.photos ?? []).map((p) => uploaded.get(p.key) ?? p);

      // 2. Смена. Порядок работ — как на экране: по заявкам.
      const entries: SubmitEntry[] = groups.flatMap((g) =>
        g.entries.map((e) => ({
          request_number: e.requestNumber,
          department_id: e.departmentId,
          ...(e.priceItemId ? { price_item_id: e.priceItemId } : { custom_name: e.customName ?? e.name, unit_id: e.unitId }),
          quantity: parseQuantity(e.quantity, e.integerOnly).value ?? Number(e.quantity.replace(',', '.')),
          note: e.note || null,
          performer_ids: e.performerIds,
          photos: toPayload(withPhotos(e)),
        })),
      );
      const requests: SubmitRequest[] = groups.map((g) => ({
        request_number: g.request,
        minutes: g.time.minutes ?? 0,
        ...(g.request ? { status: g.time.status } : {}),
      }));
      const res = await submitShift({ client_uuid: draft.clientUuid, work_date: draft.workDate, entries, requests });
      clear();
      router.dismissAll();
      router.push({ pathname: '/shift/done', params: { entries: String(res.entries), pending: String(res.pending), edited: draft.editing ? '1' : '0' } });
    } catch (e) {
      // Черновик остаётся на телефоне — можно повторить, когда появится связь.
      setError(humanError(e));
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.h}>Дата смены</Text>
        <View style={styles.chips}>
          <Chip label={`Сегодня · ${formatDate(today)}`} selected={draft.workDate === today} onPress={() => setWorkDate(today)} />
          <Chip label={`Вчера · ${formatDate(yesterday)}`} selected={draft.workDate === yesterday} onPress={() => setWorkDate(yesterday)} />
        </View>
      </Card>

      {groups.map((g) => (
        <Card key={g.request ?? '—'} style={styles.card}>
          <Text style={styles.request}>{g.request ? `Заявка ${g.request}` : 'Без заявки'}</Text>
          <Text style={[styles.time, !g.time.minutes && styles.missing]}>
            {g.time.minutes ? `Время: ${formatMinutes(g.time.minutes)}` : 'Время не указано — вернитесь к списку'}
            {g.request ? ` · ${statusText[g.time.status]}` : ''}
          </Text>
          {!g.entries.length ? <Text style={styles.meta}>Новых работ нет — только время</Text> : null}
          {g.entries.map((e) => (
            <View key={e.key} style={styles.row}>
              <Text style={styles.name}>
                {e.name}
                {!e.priceItemId ? <Text style={styles.custom}> · вне прайса</Text> : null}
              </Text>
              <Text style={styles.qty}>
                {e.quantity} {e.unitCode}
              </Text>
              <Text style={styles.meta}>
                {e.departmentName} · {e.performerNames.join(', ')}
                {e.note ? ` · ${e.note}` : ''}
                {e.photos?.length ? ` · 📷 ${e.photos.length}` : ''}
              </Text>
            </View>
          ))}
        </Card>
      ))}

      <Text style={[styles.summary, total > SHIFT_MINUTES && styles.over]}>
        Время за смену: {formatMinutes(total)} из {formatMinutes(SHIFT_MINUTES)}
      </Text>
      {total > SHIFT_MINUTES ? (
        <Text style={styles.warnBox}>Время по заявкам больше длины смены. Проверьте, нет ли ошибки. Если всё верно — отправляйте.</Text>
      ) : null}
      <Text style={styles.summary}>
        Работ: {draft.entries.length}
        {pending ? ` · вне прайса (на оценку руководителю): ${pending}` : ''}
      </Text>
      {progress ? <Text style={styles.progress}>{progress}</Text> : null}
      {error ? <Text style={styles.error}>Не отправлено: {error}</Text> : null}
      <BigButton title={error ? 'Повторить' : 'Отправить'} size="big" loading={sending} onPress={send} />
      <BigButton title="Вернуться к списку" variant="secondary" disabled={sending} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  h: { fontSize: font.body, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  request: { fontSize: font.small, fontWeight: '800', color: colors.muted, textTransform: 'uppercase' },
  row: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  name: { fontSize: font.body, fontWeight: '700' },
  custom: { fontSize: font.small, color: colors.muted, fontWeight: '400' },
  qty: { fontSize: font.body, fontWeight: '800' },
  meta: { fontSize: font.small, color: colors.muted },
  time: { fontSize: font.body, fontWeight: '800' },
  missing: { color: colors.danger },
  over: { color: colors.danger },
  warnBox: { fontSize: font.body, backgroundColor: '#FFF3C4', borderRadius: 12, padding: 12, fontWeight: '600' },
  summary: { fontSize: font.body, fontWeight: '600', textAlign: 'center' },
  error: { color: colors.danger, fontSize: font.body },
  progress: { fontSize: font.body, fontWeight: '700', textAlign: 'center' },
});
