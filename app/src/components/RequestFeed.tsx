import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { humanError } from '../lib/errors';
import { addRequestComment, eventLabel, formatStoreTime, type RequestEvent } from '../lib/requests';
import { TourTarget } from '../lib/tour';
import { colors, font, radius } from '../theme';
import { Card } from './Card';

/**
 * Переписка по заявке: сообщения мастера и руководителя, события (взял, отправил, вернул…) — серым мелко.
 * Сверху старые, внизу новые; под лентой — поле «Написать».
 */
export function RequestFeed({ requestId, events, onSent }: { requestId: number; events: RequestEvent[]; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = [...events].reverse();

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setErr(null);
    try {
      await addRequestComment(requestId, t);
      setText('');
      onSent();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.label}>Сообщения и история</Text>
      {!list.length ? <Text style={styles.empty}>Пока пусто. Напишите, если нужно что-то уточнить.</Text> : null}
      {list.map((e, i) =>
        e.kind === 'comment' ? (
          <View key={i} style={[styles.bubble, e.mine ? styles.mine : styles.theirs]}>
            <Text style={styles.author}>
              {e.mine ? 'Вы' : e.author ?? '—'} · {formatStoreTime(e.at)}
            </Text>
            <Text style={styles.text} selectable>
              {e.comment}
            </Text>
          </View>
        ) : (
          <Text key={i} style={styles.event}>
            {formatStoreTime(e.at)} · {e.mine ? 'Вы' : e.author ?? 'Система'}: {eventLabel[e.kind].toLowerCase()}
            {e.comment ? ` — ${e.comment}` : ''}
          </Text>
        ),
      )}
      <TourTarget id="card.comment">
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Написать сообщение…"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={1000}
            style={styles.input}
            accessibilityLabel="Сообщение по заявке"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Отправить сообщение"
            disabled={busy || !text.trim()}
            onPress={send}
            style={({ pressed }) => [styles.send, (busy || !text.trim()) && styles.sendOff, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.sendText}>{busy ? '…' : '➤'}</Text>
          </Pressable>
        </View>
      </TourTarget>
      <Text style={styles.hint}>Без имён, фамилий и телефонов людей.</Text>
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  empty: { fontSize: font.small, color: colors.muted },
  bubble: { borderRadius: radius.card, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '88%', gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#FFF3C4' },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.bg },
  author: { fontSize: font.small - 1, fontWeight: '700', color: colors.secondary },
  text: { fontSize: font.body },
  event: { fontSize: font.small - 1, color: colors.muted, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: font.body,
    backgroundColor: colors.card,
  },
  send: { width: 48, height: 44, borderRadius: radius.control, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
  sendText: { fontSize: 20, fontWeight: '800' },
  hint: { fontSize: font.small - 2, color: colors.muted },
  err: { color: colors.danger, fontSize: font.small },
});
