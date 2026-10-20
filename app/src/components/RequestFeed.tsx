import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';
import { useAuth } from '../lib/auth';
import { confirm } from '../lib/confirm';
import { humanError } from '../lib/errors';
import { addRequestComment, deleteRequestComment, editRequestComment, eventText, formatStoreTime, type RequestEvent } from '../lib/requests';
import { TourTarget, useScrollBy } from '../lib/tour';
import { colors, font, letterSpacing, lineHeight, opacity, radius, space, stroke, touch } from '../theme';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { Card } from './Card';
import { keepAboveKeyboard } from './Screen';

/** Поле растёт до 6 строк, дальше — прокрутка внутри поля. */
const LINE = lineHeight.list;
const MAX_LINES = 6;

/**
 * Переписка по заявке: сообщения мастера и руководителя, события (взял, отправил, вернул…) — серым мелко.
 * Сверху старые, внизу новые; под лентой — поле «Написать». Поле всегда держится над клавиатурой.
 * Своё сообщение можно исправить или удалить, руководитель может удалить любое.
 */
export function RequestFeed({ requestId, events, onSent }: { requestId: number; events: RequestEvent[]; onSent: () => void }) {
  const { me } = useAuth();
  const manager = me?.role === 'manager';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Исправляемое сообщение (null — пишем новое). */
  const [editing, setEditing] = useState<RequestEvent | null>(null);
  const list = [...events].reverse();
  const scrollBy = useScrollBy();
  const box = useRef<View>(null);
  const input = useRef<TextInput>(null);
  const focused = useRef(false);

  // Клавиатура появилась или поле выросло — поле ввода не должно уходить под клавиатуру.
  const keepVisible = () => setTimeout(() => focused.current && keepAboveKeyboard(box.current, scrollBy), 120);
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', keepVisible);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollBy]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setErr(null);
    try {
      if (editing?.id) await editRequestComment(editing.id, t);
      else await addRequestComment(requestId, t);
      setText('');
      setEditing(null);
      onSent();
    } catch (e) {
      // текст не пропадает — можно повторить
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: RequestEvent) {
    if (!e.id) return;
    const theirs = !e.mine;
    if (!(await confirm('Удалить сообщение?', theirs ? `Сообщение ${e.author ?? ''} будет удалено у всех.` : 'Сообщение будет удалено у всех.', 'Удалить'))) return;
    setErr(null);
    try {
      await deleteRequestComment(e.id);
      if (editing?.id === e.id) cancelEdit();
      onSent();
    } catch (x) {
      setErr(humanError(x));
    }
  }

  function startEdit(e: RequestEvent) {
    setEditing(e);
    setText(e.comment ?? '');
    setErr(null);
    setTimeout(() => input.current?.focus(), 50);
  }

  function cancelEdit() {
    setEditing(null);
    setText('');
  }

  /** Нажатие на сообщение: своё — исправить или удалить, руководителю — удалить чужое. */
  const [menuFor, setMenuFor] = useState<RequestEvent | null>(null);
  function openMenu(e: RequestEvent) {
    if (!e.id || e.deleted || !(e.mine || manager)) return;
    setMenuFor(e);
  }
  const menuActions: SheetAction[] = menuFor
    ? [
        ...(menuFor.mine ? [{ label: 'Изменить', onPress: () => startEdit(menuFor) }] : []),
        { label: 'Удалить', danger: true, onPress: () => remove(menuFor) },
      ]
    : [];

  const canSend = !busy && !!text.trim() && !(editing && text.trim() === (editing.comment ?? '').trim());

  return (
    <Card style={styles.card}>
      <ActionSheet visible={!!menuFor} title={menuFor?.comment ?? undefined} actions={menuActions} onClose={() => setMenuFor(null)} />
      <Text style={styles.label}>СООБЩЕНИЯ</Text>
      {!list.length ? <Text style={styles.empty}>Пока пусто. Напишите, если нужно что-то уточнить.</Text> : null}
      {list.map((e, i) =>
        e.kind === 'comment' ? (
          e.deleted ? (
            <Text key={e.id ?? i} style={[styles.event, styles.deleted]}>
              {formatStoreTime(e.at)} · {e.mine ? 'Вы' : e.author ?? '—'}: сообщение удалено
            </Text>
          ) : (
            <Pressable
              key={e.id ?? i}
              onPress={() => openMenu(e)}
              onLongPress={() => openMenu(e)}
              disabled={!e.id || !(e.mine || manager)}
              accessibilityRole={e.id && (e.mine || manager) ? 'button' : undefined}
              accessibilityHint={e.mine ? 'Исправить или удалить' : manager ? 'Удалить' : undefined}
              style={({ pressed }) => [styles.bubble, e.mine ? styles.mine : styles.theirs, editing?.id === e.id && styles.editingBubble, pressed && { opacity: opacity.pressed }]}
            >
              <Text style={styles.author}>
                {e.mine ? 'Вы' : e.author ?? '—'} · {formatStoreTime(e.at)}
                {e.edited ? ' · изменено' : ''}
              </Text>
              <Text style={styles.text} selectable={!e.id || !(e.mine || manager)}>
                {e.comment}
              </Text>
            </Pressable>
          )
        ) : (
          <Text key={e.id ?? i} style={styles.event}>
            {formatStoreTime(e.at)} · {e.mine ? 'Вы' : e.author ?? 'Система'}: {eventText(e.kind)}
            {e.comment ? ` — ${e.comment}` : ''}
          </Text>
        ),
      )}
      {list.some((e) => e.kind === 'comment' && e.mine && e.id && !e.deleted) ? (
        <Text style={styles.hint}>Нажмите на своё сообщение, чтобы исправить или удалить.</Text>
      ) : null}
      <View ref={box} collapsable={false} style={styles.composer}>
        {editing ? (
          <View style={styles.editBar}>
            <Text style={styles.editText}>Исправление сообщения</Text>
            <Pressable accessibilityRole="button" hitSlop={space.s12} onPress={cancelEdit}>
              <Text style={styles.editCancel}>Отменить</Text>
            </Pressable>
          </View>
        ) : null}
        <TourTarget id="card.comment">
          <View style={styles.inputRow}>
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              placeholder="Написать сообщение…"
              placeholderTextColor={colors.muted}
              multiline
              scrollEnabled
              maxLength={1000}
              textAlignVertical="top"
              style={styles.input}
              accessibilityLabel={editing ? 'Исправление сообщения' : 'Сообщение по заявке'}
              onFocus={() => {
                focused.current = true;
                keepVisible();
              }}
              onBlur={() => {
                focused.current = false;
              }}
              onContentSizeChange={keepVisible}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Сохранить исправление' : 'Отправить сообщение'}
              disabled={!canSend}
              onPress={send}
              hitSlop={space.s6}
              style={({ pressed }) => [styles.send, !canSend && styles.sendOff, pressed && { opacity: opacity.pressed }]}
            >
              <Text style={styles.sendText}>{busy ? '…' : editing ? '✓' : '➤'}</Text>
            </Pressable>
          </View>
        </TourTarget>
        {err ? (
          <View style={styles.errRow}>
            <Text style={styles.err}>Не отправлено: {err}</Text>
            <Pressable accessibilityRole="button" hitSlop={space.s10} onPress={send} disabled={busy} style={styles.retry}>
              <Text style={styles.retryText}>Повторить</Text>
            </Pressable>
          </View>
        ) : null}
        <Text style={styles.hint}>Без имён, фамилий и телефонов людей.</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s10, paddingHorizontal: space.s18 },
  label: { fontSize: font.caption, fontWeight: '700', letterSpacing: letterSpacing.caps },
  empty: { fontSize: font.small, color: colors.secondary },
  bubble: {
    borderRadius: radius.control,
    paddingHorizontal: space.s12,
    paddingVertical: space.s10,
    maxWidth: '85%',
    gap: space.s2,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.note, borderBottomRightRadius: radius.tiny },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.bg, borderBottomLeftRadius: radius.tiny },
  editingBubble: { borderWidth: stroke.outline, borderColor: colors.black },
  author: { fontSize: font.caption, color: colors.secondary },
  text: { fontSize: font.list, lineHeight: lineHeight.list },
  event: { fontSize: font.caption, color: colors.secondary, textAlign: 'center' },
  deleted: { fontStyle: 'italic' },
  composer: { gap: space.s6, marginTop: space.s4 },
  editBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.bg, borderRadius: radius.control, paddingHorizontal: space.s10, paddingVertical: space.s6 },
  editText: { fontSize: font.small, fontWeight: '700' },
  editCancel: { fontSize: font.small, fontWeight: '700', color: colors.danger },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s8 },
  input: {
    flex: 1,
    minHeight: touch.min,
    maxHeight: LINE * MAX_LINES + space.s20,
    borderWidth: stroke.hair,
    borderColor: colors.field,
    borderRadius: radius.small,
    paddingHorizontal: space.s12,
    paddingVertical: space.s10,
    fontSize: font.body,
    lineHeight: LINE,
    backgroundColor: colors.card,
  },
  send: { width: touch.min, height: touch.min, borderRadius: radius.control, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: opacity.disabled },
  sendText: { fontSize: font.number, fontWeight: '700' },
  hint: { fontSize: font.caption, color: colors.secondary },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: space.s8 },
  err: { flex: 1, color: colors.danger, fontSize: font.small },
  retry: { paddingHorizontal: space.s12, paddingVertical: space.s8, borderRadius: radius.control, borderWidth: stroke.outline, borderColor: colors.black },
  retryText: { fontSize: font.small, fontWeight: '700' },
});
