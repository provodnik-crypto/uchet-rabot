import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../components/Text';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { confirm } from '../../lib/confirm';
import { formatDate, maskDateInput, parseDate } from '../../lib/dates';
import { humanError } from '../../lib/errors';
import { inWindow, recheckDescription, titleFromText, type ItsmFile, type ItsmRow } from '../../lib/itsm';
import {
  formatRegistered,
  formatStoreTime,
  importApply,
  importContext,
  lifecycleLabel,
  pickItsmFile,
  prepareItsmPhotos,
  setRequestPhones,
  uploadItsmPhotos,
  type ImportContext,
  type MissingRequest,
} from '../../lib/requests';
import { forgetLocalPhotos, type DraftPhoto } from '../../lib/workPhotos';
import { colors, font, radius, size, space, stroke, touch } from '../../theme';

type Result = {
  inserted: number;
  skipped: number;
  closed: number;
  outside: number;
  errors: number;
  /** Фото добавлены к стольким заявкам; не загрузились — номера. */
  photoRequests?: number;
  photoFailed?: string[];
  phones?: number;
};

/** Заявка у мастера (в работе, на паузе, на проверке) — при загрузке файла её не закрываем. */
const atMaster = (m: MissingRequest) => m.status === 'in_work' || m.status === 'paused' || m.status === 'review';

export default function ImportScreen() {
  const [file, setFile] = useState<ItsmFile | null>(null);
  const [ctx, setCtx] = useState<ImportContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [withOutside, setWithOutside] = useState(false);
  const [close, setClose] = useState<Record<number, boolean>>({});
  const [edits, setEdits] = useState<Record<number, { text: string; suspects: string[] }>>({});
  const [editing, setEditing] = useState<number | null>(null);
  // фото из столбца «Фото»: сжатые копии по номеру заявки; крестик убирает фото из загрузки
  const [photos, setPhotos] = useState<Record<string, DraftPhoto[]>>({});
  const [photoFailed, setPhotoFailed] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);

  function reset(keepPhotos = false) {
    if (!keepPhotos) forgetLocalPhotos(Object.values(photos).flat());
    setPhotos({});
    setPhotoFailed(0);
    setFile(null);
    setCtx(null);
    setClose({});
    setEdits({});
    setEditing(null);
    setWithOutside(false);
  }

  async function choose() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const f = await pickItsmFile();
      if (!f) return;
      if (f.missingColumns.length) throw new Error(`В файле нет столбцов: ${f.missingColumns.join(', ')}`);
      const c = await importContext(Array.from(new Set(f.rows.map((r) => r.number))));
      reset();
      const prepared = await prepareItsmPhotos(f.rows, setProgress);
      // байты картинок больше не нужны — освобождаем память
      for (const r of f.rows) r.photos = [];
      setPhotos(prepared.photos);
      setPhotoFailed(prepared.failed);
      setFile(f);
      setCtx(c);
      setFromText(c.window_from ? formatDate(c.window_from) : '');
      setToText(c.window_to ? formatDate(c.window_to) : '');
    } catch (e) {
      setError(humanError(e));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  const windowFrom = fromText.trim() ? parseDate(fromText) : null;
  const windowTo = toText.trim() ? parseDate(toText) : null;
  const windowError =
    (fromText.trim() && !windowFrom) || (toText.trim() && !windowTo)
      ? 'Дата в виде ДД.ММ.ГГГГ'
      : windowFrom && windowTo && windowFrom > windowTo
        ? '«С» позже, чем «по»'
        : null;

  const plan = useMemo(() => {
    if (!file || !ctx) return null;
    const stores = new Set(ctx.stores.map((s) => s.code));
    const existing = new Set(ctx.existing);
    const seen = new Set<string>();
    const errors: { row: ItsmRow; why: string }[] = [];
    const unknownStores = new Set<string>();
    const fresh: ItsmRow[] = [];
    const existingRows: ItsmRow[] = [];
    let existingCount = 0;
    for (const r of file.rows) {
      if (r.errors.length) {
        errors.push({ row: r, why: r.errors.join('; ') });
        continue;
      }
      if (seen.has(r.number)) {
        errors.push({ row: r, why: 'номер повторяется в файле' });
        continue;
      }
      seen.add(r.number);
      if (!stores.has(r.storeCode!)) {
        unknownStores.add(r.storeCode!);
        errors.push({ row: r, why: `магазина ${r.storeCode} нет в справочнике` });
        continue;
      }
      if (existing.has(r.number)) {
        existingCount++;
        existingRows.push(r);
      } else fresh.push(r);
    }
    const inside = fresh.filter((r) => inWindow(r.registeredAt, windowFrom, windowTo));
    const outside = fresh.filter((r) => !inWindow(r.registeredAt, windowFrom, windowTo));
    return { errors, unknownStores: Array.from(unknownStores), fresh, inside, outside, existingCount, existingRows };
  }, [file, ctx, windowFrom, windowTo]);

  const toLoad = plan ? (withOutside ? [...plan.inside, ...plan.outside] : plan.inside) : [];
  const descOf = (r: ItsmRow) => edits[r.line] ?? { text: r.description, suspects: r.suspects };
  /** Название: в новом шаблоне собирается из текста — после правки текста пересобираем, чтобы убранное не осталось в названии. */
  const titleOf = (r: ItsmRow) => (r.autoTitle && edits[r.line] ? titleFromText(recheckDescription(edits[r.line].text).text) : r.operation);
  const flagged = toLoad.filter((r) => descOf(r).suspects.length);
  const noRequester = toLoad.filter((r) => r.requesterUnrecognized);
  const closeIds = Object.entries(close).filter(([, v]) => v).map(([k]) => Number(k));
  const dueUpdates = plan ? plan.existingRows.filter((r) => r.dueAt).map((r) => ({ number: r.number, due_at: r.dueAt! })) : [];
  // фото и телефоны — у тех, что загружаются сейчас, и у загруженных раньше (если у них ещё нет)
  const target = plan ? [...toLoad, ...plan.existingRows] : [];
  const photoRows = target.filter((r) => photos[r.number]?.length);
  const photoCount = photoRows.reduce((n, r) => n + photos[r.number].length, 0);
  const phones = target.filter((r) => r.contactPhone).map((r) => ({ number: r.number, phone: r.contactPhone! }));
  const removePhoto = (number: string, key: string) => {
    const gone = (photos[number] ?? []).filter((p) => p.key === key);
    forgetLocalPhotos(gone);
    setPhotos({ ...photos, [number]: (photos[number] ?? []).filter((p) => p.key !== key) });
  };

  async function upload() {
    if (!file || !ctx || !plan || windowError) return;
    const applyNeeded = toLoad.length > 0 || closeIds.length > 0 || dueUpdates.length > 0;
    if (!applyNeeded && !photoRows.length && !phones.length) {
      setError('Загружать нечего: новых заявок в выбранном периоде нет и ничего не отмечено «Закрыть».');
      return;
    }
    const ok = await confirm(
      'Загрузить заявки?',
      `Новых заявок: ${toLoad.length}${dueUpdates.length ? `\nОбновить срок у загруженных раньше: ${dueUpdates.length}` : ''}${closeIds.length ? `\nЗакрыть пропавших: ${closeIds.length}` : ''}${photoRows.length ? `\nФото: ${photoCount} у ${photoRows.length} заявок` : ''}`,
      'Загрузить',
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const empty = { import_id: 0, inserted: 0, skipped: 0, closed: 0 };
      const res = !applyNeeded ? empty : await importApply({
        rows: toLoad.map((r) => ({
          number: r.number,
          store_code: r.storeCode!,
          service: r.service,
          operation: titleOf(r),
          // правку руководителя ещё раз чистим от телефонов и почт
          description: edits[r.line] ? recheckDescription(edits[r.line].text).text : r.description,
          status: r.status,
          registered_at: r.registeredAt!,
          requester: r.requester,
          due_at: r.dueAt,
        })),
        due_updates: dueUpdates,
        close_ids: closeIds,
        window_from: windowFrom,
        window_to: windowTo,
        file_rows: file.rows.length,
        existing_rows: plan.existingCount,
        outside_rows: withOutside ? 0 : plan.outside.length,
        error_rows: plan.errors.length,
      });
      // заявки уже в базе: телефоны и фото не мешают загрузке — ошибка здесь покажется в итоге
      const phonesSet = await setRequestPhones(phones).catch(() => 0);
      const ph = photoRows.length
        ? await uploadItsmPhotos(Object.fromEntries(photoRows.map((r) => [r.number, photos[r.number]])), setProgress).catch(() => ({
            requests: 0,
            failed: photoRows.map((r) => r.number),
          }))
        : { requests: 0, failed: [] };
      setResult({
        ...res,
        outside: withOutside ? 0 : plan.outside.length,
        errors: plan.errors.length,
        photoRequests: ph.requests,
        photoFailed: ph.failed,
        phones: phonesSet,
      });
      reset();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  if (!file || !ctx || !plan) {
    return (
      <Screen>
        {result ? (
          <Card style={styles.done}>
            <Text style={styles.doneTitle}>Загружено новых заявок: {result.inserted}</Text>
            {result.skipped ? <Text style={styles.body}>Уже были в базе: {result.skipped}</Text> : null}
            {result.closed ? <Text style={styles.body}>Закрыто пропавших: {result.closed}</Text> : null}
            {result.outside ? <Text style={styles.body}>Не загружены (вне периода): {result.outside}</Text> : null}
            {result.errors ? <Text style={styles.body}>Строк с ошибками: {result.errors}</Text> : null}
            {result.photoRequests ? <Text style={styles.body}>Фото добавлены к заявкам: {result.photoRequests}</Text> : null}
            {result.phones ? <Text style={styles.body}>Рабочий телефон записан у заявок: {result.phones}</Text> : null}
            {result.photoFailed?.length ? (
              <Text style={styles.warn}>
                Не загрузились фото у заявок: {result.photoFailed.join(', ')}. Выберите тот же файл ещё раз — догрузятся только они.
              </Text>
            ) : null}
            <Text style={styles.meta}>Запись в журнале загрузок сделана. Сам файл нигде не сохранён.</Text>
          </Card>
        ) : null}
        <Text style={styles.body}>
          Выгрузите заявки из ITSM в Excel (.xlsx) и выберите файл. Ничего не запишется, пока вы не нажмёте «Загрузить».
        </Text>
        <Text style={styles.meta}>
          Файл читается только на этом телефоне. В базу попадает очищенный текст: без телефонов, почт, отчеств и фамилий заявителей.
        </Text>
        <Text style={styles.meta}>Есть столбец «Фото» — картинки из него загрузятся к заявкам. Нет столбца — всё как обычно.</Text>
        {progress ? <Text style={styles.meta}>{progress}</Text> : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <BigButton title={busy ? 'Читаю файл…' : 'Выбрать файл'} size="big" loading={busy} onPress={choose} />
      </Screen>
    );
  }

  const sample = toLoad.slice(0, 3);

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.h}>Что в файле</Text>
        <Stat label="Строк в файле" value={file.rows.length} />
        <Stat label="Уже есть в базе" value={plan.existingCount} />
        <Stat label="Новых" value={plan.fresh.length} />
        <Stat label="  из них в выбранном периоде" value={plan.inside.length} />
        <Stat label="  вне выбранного периода" value={plan.outside.length} />
        <Stat label="С ошибками (не загрузятся)" value={plan.errors.length} warn={plan.errors.length > 0} />
        {file.unknownColumns.map((c) => (
          <Text key={c} style={styles.warn}>Пропущен неизвестный столбец «{c}»</Text>
        ))}
        {file.absentColumns.map((c) => (
          <Text key={c} style={styles.warn}>Нет столбца «{c}» — поле останется пустым</Text>
        ))}
        {plan.unknownStores.length ? (
          <Text style={styles.warn}>Магазинов нет в справочнике: {plan.unknownStores.join(', ')}. Эти строки не загрузятся.</Text>
        ) : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>Период по дате регистрации</Text>
        {ctx.first ? (
          <Text style={styles.meta}>Первая загрузка: по умолчанию берутся все заявки файла.</Text>
        ) : (
          <Text style={styles.meta}>
            Прошлая загрузка: {ctx.last_import_at ? formatStoreTime(ctx.last_import_at) : '—'}.
            По умолчанию — прошлый рабочий день (и выходные после него).
          </Text>
        )}
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label="С" value={fromText} onChangeText={(t) => setFromText(maskDateInput(t))} placeholder="без ограничения" keyboardType="number-pad" maxLength={10} />
          </View>
          <View style={styles.flex}>
            <Field label="По" value={toText} onChangeText={(t) => setToText(maskDateInput(t))} placeholder="без ограничения" keyboardType="number-pad" maxLength={10} />
          </View>
        </View>
        {windowError ? <Text style={styles.err}>{windowError}</Text> : null}
        {plan.outside.length ? (
          <View style={styles.outside}>
            <Text style={styles.body}>Вне выбранного периода: {plan.outside.length}</Text>
            <Chip label={withOutside ? 'Загрузить тоже ✓' : 'Загрузить тоже'} selected={withOutside} onPress={() => setWithOutside(!withOutside)} />
          </View>
        ) : null}
      </Card>

      {ctx.missing.length ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Пропали из файла: {ctx.missing.length}</Text>
          <Text style={styles.meta}>
            Эти открытые заявки есть в приложении, но их нет в файле — скорее всего, их закрыли в ITSM. Сами они не закроются.
          </Text>
          <View style={styles.row}>
            <Chip label="Закрыть все свободные" onPress={() => setClose(Object.fromEntries(ctx.missing.filter((m) => !atMaster(m)).map((m) => [m.id, true])))} />
            <Chip label="Оставить все" onPress={() => setClose({})} />
          </View>
          {ctx.missing.map((m) => (
            <View key={m.id} style={styles.missing}>
              <Text style={styles.number}>{m.number}</Text>
              <Text style={styles.body} numberOfLines={2}>{m.operation ?? ''}{m.description ? ` — ${m.description}` : ''}</Text>
              <Text style={styles.meta}>{formatRegistered(m.registered_at)}</Text>
              {atMaster(m) ? (
                <Text style={styles.warn}>
                  У мастера{m.master ? ` ${m.master}` : ''}: {m.status ? lifecycleLabel[m.status] : ''}
                  {m.works ? ` · работ: ${m.works}` : ''} — здесь не закрывается. Решите в карточке заявки.
                </Text>
              ) : (
                <View style={styles.row}>
                  <Chip label="Закрыть" selected={!!close[m.id]} onPress={() => setClose({ ...close, [m.id]: true })} />
                  <Chip label="Оставить" selected={!close[m.id]} onPress={() => setClose({ ...close, [m.id]: false })} />
                </View>
              )}
            </View>
          ))}
        </Card>
      ) : null}

      {flagged.length ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Проверьте: возможно, остались имена ({flagged.length})</Text>
          <Text style={styles.meta}>
            Подсвечены слова с заглавной буквы, похожие на имена и фамилии. Если это человек — нажмите «Исправить» и удалите.
            Названия товаров и мест можно оставить.
          </Text>
          {flagged.map((r) => {
            const d = descOf(r);
            return (
              <View key={r.line} style={styles.missing}>
                <Text style={styles.number}>{r.number}</Text>
                {editing === r.line ? (
                  <>
                    <TextInput
                      style={styles.edit}
                      multiline
                      autoFocus
                      defaultValue={d.text}
                      onChangeText={(t) => setEdits({ ...edits, [r.line]: { text: t, suspects: d.suspects } })}
                    />
                    <BigButton
                      title="Готово"
                      variant="secondary"
                      onPress={() => {
                        setEdits({ ...edits, [r.line]: recheckDescription(descOf(r).text) });
                        setEditing(null);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <Highlighted text={d.text} words={d.suspects} />
                    <Chip label="Исправить" onPress={() => setEditing(r.line)} />
                  </>
                )}
              </View>
            );
          })}
        </Card>
      ) : null}

      {noRequester.length ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Заявитель не распознан: {noRequester.length}</Text>
          <Text style={styles.meta}>Заявки загрузятся без заявителя.</Text>
          <Text style={styles.body}>{noRequester.map((r) => r.number).join(', ')}</Text>
        </Card>
      ) : null}

      {plan.errors.length ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Строки с ошибками: {plan.errors.length}</Text>
          {plan.errors.slice(0, 30).map((e) => (
            <Text key={e.row.line} style={styles.meta}>
              Строка {e.row.line}{e.row.number ? ` (${e.row.number})` : ''}: {e.why}
            </Text>
          ))}
        </Card>
      ) : null}

      {sample.length ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Как заявки попадут в приложение (пример)</Text>
          {sample.map((r) => (
            <View key={r.line} style={styles.missing}>
              <Text style={styles.number}>{r.number}</Text>
              <Text style={styles.meta}>{[r.service, titleOf(r)].filter(Boolean).join(' · ')}</Text>
              {r.contactPhone ? <Text style={styles.body}>Тел. инициатора: {r.contactPhone}</Text> : null}
              <Text style={styles.body}>{descOf(r).text || '—'}</Text>
              <Text style={styles.meta}>
                {formatRegistered(r.registeredAt)} · {r.requester ?? 'заявитель не указан'} · магазин {r.storeCode} · {r.status ?? ''}
                {r.dueAt ? ` · срок до ${formatRegistered(r.dueAt)}` : ''}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {file.photoColumn ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Фото из файла{photoCount ? `: ${photoCount}` : ''}</Text>
          <Text style={styles.meta}>
            Мастер увидит их в карточке заявки. Если на фото человек или лишнее — нажмите ✕, это фото не загрузится.
            У заявок, где фото уже есть, повторно не загружаются.
          </Text>
          {!photoRows.length ? <Text style={styles.body}>В столбце «Фото» для этих заявок картинок нет.</Text> : null}
          {photoFailed ? <Text style={styles.warn}>Не удалось открыть картинок: {photoFailed} (формат не поддерживается).</Text> : null}
          {file.skippedPhotos ? <Text style={styles.warn}>Больше 3 фото у заявки — лишние пропущены: {file.skippedPhotos}</Text> : null}
          {photoRows.map((r) => (
            <View key={r.line} style={styles.missing}>
              <Text style={styles.number}>{r.number}</Text>
              <View style={styles.row}>
                {photos[r.number].map((p) => (
                  <View key={p.key}>
                    <Image source={{ uri: p.thumbUri ?? p.localUri }} style={styles.thumb} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Не загружать это фото"
                      hitSlop={space.s8}
                      onPress={() => removePhoto(r.number, p.key)}
                      style={styles.remove}
                    >
                      <Text style={styles.removeText}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {progress ? <Text style={styles.meta}>{progress}</Text> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <BigButton
        title={`Загрузить${toLoad.length ? ` (${toLoad.length})` : ''}`}
        size="big"
        loading={busy}
        disabled={!!windowError}
        onPress={upload}
      />
      <BigButton title="Отмена" variant="secondary" onPress={() => { reset(); setError(null); }} />
    </Screen>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.body}>{label}</Text>
      <Text style={[styles.statValue, warn && { color: colors.danger }]}>{value}</Text>
    </View>
  );
}

/** Текст с подсвеченными словами. */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <Text style={styles.body}>{text}</Text>;
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${esc.join('|')})`, 'g'));
  return (
    <Text style={styles.body}>
      {parts.map((p, i) =>
        words.includes(p) ? (
          <Text key={i} style={styles.mark}>{p}</Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s10 },
  h: { fontSize: font.body, fontWeight: '800' },
  body: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.muted },
  warn: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
  err: { color: colors.danger, fontSize: font.body },
  row: { flexDirection: 'row', gap: space.s8, flexWrap: 'wrap' },
  flex: { flex: 1 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', gap: space.s8 },
  statValue: { fontSize: font.body, fontWeight: '800' },
  outside: { gap: space.s8 },
  missing: { gap: space.s6, borderTopWidth: stroke.hair, borderTopColor: colors.border, paddingTop: space.s10 },
  number: { fontSize: font.body, fontWeight: '800' },
  mark: { backgroundColor: colors.brand, fontWeight: '800' },
  edit: {
    minHeight: size.bigText,
    borderWidth: stroke.outline,
    borderColor: colors.border,
    borderRadius: radius.control,
    padding: space.s12,
    fontSize: font.body,
    textAlignVertical: 'top',
    backgroundColor: colors.card,
  },
  done: { gap: space.s6, borderWidth: stroke.outline, borderColor: colors.success },
  doneTitle: { fontSize: font.title, fontWeight: '800', color: colors.success },
  thumb: { width: size.thumbSmall, height: size.thumbSmall, borderRadius: radius.small, backgroundColor: colors.bg },
  remove: {
    position: 'absolute',
    top: -space.s6,
    right: -space.s6,
    width: touch.tiny - space.s8,
    height: touch.tiny - space.s8,
    borderRadius: radius.round,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: colors.white, fontSize: font.small, fontWeight: '800' },
});
