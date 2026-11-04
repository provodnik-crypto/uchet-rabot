import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { confirm } from '../lib/confirm';
import { humanError } from '../lib/errors';
import { attachRequestPhotos, deleteRequestPhoto, requestExtras } from '../lib/requests';
import { useFocusQuery } from '../lib/useQuery';
import { forgetLocalPhotos, uploadAll, type DraftPhoto, type RemotePhoto } from '../lib/workPhotos';
import { colors, font, space } from '../theme';
import { BigButton } from './BigButton';
import { PhotoPicker } from './PhotoPicker';
import { PhotoStrip } from './PhotoStrip';
import { Text } from './Text';

/**
 * Под описанием заявки: рабочий телефон инициатора (031xxx) и фото заявки (из файла ITSM и добавленные в карточке).
 * Нажатие на фото — на весь экран. «Добавить фото» — руководитель или мастер, у которого заявка в работе;
 * новые фото добавляются к имеющимся. ✕ — у своих фото (у руководителя — у всех).
 * manage={false} — только показ (экран проверки).
 */
export function RequestExtras({ requestId, manage = true }: { requestId: number; manage?: boolean }) {
  const { data, reload } = useFocusQuery(() => requestExtras(requestId).catch(() => null), { key: `extras:${requestId}` });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftPhoto[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canAdd = manage && !!data?.can_add;
  if (!data || (!data.contact_phone && !data.photos.length && !canAdd)) return null;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // загруженные запоминаем: «Сохранить фото» ещё раз не грузит их заново
      const uploaded = await uploadAll(draft, setProgress);
      setDraft(uploaded);
      await attachRequestPhotos(requestId, uploaded);
      forgetLocalPhotos(uploaded);
      setDraft([]);
      setAdding(false);
      reload();
    } catch (e) {
      setErr(`Фото не сохранились: ${humanError(e)}. Нажмите «Сохранить фото» ещё раз.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function cancel() {
    forgetLocalPhotos(draft);
    setDraft([]);
    setAdding(false);
    setErr(null);
  }

  async function remove(index: number) {
    const p = data?.photos[index];
    if (!p?.id) return;
    if (!(await confirm('Удалить фото?', 'Фото пропадёт из заявки у всех.', 'Удалить'))) return;
    setErr(null);
    try {
      await deleteRequestPhoto(p.id);
      reload();
    } catch (e) {
      setErr(humanError(e));
    }
  }

  return (
    <View style={styles.wrap}>
      {data.contact_phone ? (
        <Text style={styles.phone} selectable>
          Тел. инициатора: <Text style={styles.bold}>{data.contact_phone}</Text>
        </Text>
      ) : null}
      {data.photos.length ? (
        <>
          <Text style={styles.meta}>Фото заявки — нажмите, чтобы открыть</Text>
          <PhotoStrip
            photos={data.photos as unknown as RemotePhoto[]}
            onDelete={manage ? { can: (i) => !!data.photos[i]?.can_delete && !!data.photos[i]?.id, run: remove } : undefined}
          />
        </>
      ) : null}
      {canAdd && adding ? (
        <View style={styles.add}>
          <PhotoPicker photos={draft} onChange={setDraft} buttons />
          {progress ? <Text style={styles.meta}>{progress}</Text> : null}
          <View style={styles.buttons}>
            <View style={styles.flex}>
              <BigButton title="Сохранить фото" loading={busy} disabled={!draft.length || busy} onPress={save} />
            </View>
            <View style={styles.flex}>
              <BigButton title="Отмена" variant="secondary" disabled={busy} onPress={cancel} />
            </View>
          </View>
        </View>
      ) : canAdd ? (
        <BigButton title="Добавить фото" variant="secondary" size="small" onPress={() => setAdding(true)} />
      ) : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s6 },
  phone: { fontSize: font.body },
  bold: { fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
  add: { gap: space.s8 },
  buttons: { flexDirection: 'row', gap: space.s8 },
  flex: { flex: 1 },
  err: { fontSize: font.small, color: colors.danger },
});
