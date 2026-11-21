import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { humanError } from '../lib/errors';
import { stripContacts } from '../lib/itsm';
import { setRequestTitle } from '../lib/requests';
import { colors, font, iconSize, space, touch } from '../theme';
import { BigButton } from './BigButton';
import { Field } from './Field';
import { Icon } from './Icon';
import { Text } from './Text';

/** Лишние пробелы: по краям и подряд. */
export const cleanTitle = (t: string) => t.replace(/\s+/g, ' ').trim();

/**
 * Название заявки с ✏️: нажал — поле, «Сохранить» / «Отмена».
 * Права проверяет сервер (руководитель — любую, мастер — свою, пока не на проверке); без права карандаша нет.
 */
export function RequestTitle({
  requestId,
  title,
  canEdit,
  onSaved,
}: {
  requestId: number;
  title: string | null;
  canEdit: boolean;
  onSaved: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(title ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (editing) {
    // телефоны и почты в названии не храним
    const value = cleanTitle(stripContacts(text));
    const save = async () => {
      if (!value) return setErr('Название не может быть пустым');
      setBusy(true);
      setErr(null);
      try {
        await setRequestTitle(requestId, value);
        setEditing(false);
        onSaved(value);
      } catch (e) {
        setErr(humanError(e));
      } finally {
        setBusy(false);
      }
    };
    return (
      <View style={styles.edit}>
        <Field label="Название заявки" value={text} onChangeText={setText} autoFocus maxLength={200} error={err} hint="Без имён, фамилий и телефонов." />
        <View style={styles.buttons}>
          <View style={styles.flex}>
            <BigButton title="Сохранить" loading={busy} disabled={!value || busy} onPress={save} />
          </View>
          <View style={styles.flex}>
            <BigButton title="Отмена" variant="secondary" disabled={busy} onPress={() => (setEditing(false), setErr(null))} />
          </View>
        </View>
      </View>
    );
  }

  if (!title && !canEdit) return null;
  return (
    <View style={styles.row}>
      <Text style={[styles.title, !title && styles.empty]} selectable>
        {title || 'Без названия'}
      </Text>
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Изменить название"
          hitSlop={space.s8}
          onPress={() => {
            setText(title ?? '');
            setEditing(true);
          }}
          style={({ pressed }) => [styles.pen, pressed && styles.penPressed]}
        >
          <Icon name="edit" size={iconSize.medium} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s8 },
  title: { flex: 1, fontSize: font.body, fontWeight: '700' },
  empty: { color: colors.muted },
  pen: { width: touch.tiny, height: touch.tiny, borderRadius: touch.tiny / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  penPressed: { backgroundColor: colors.border },
  edit: { gap: space.s8 },
  buttons: { flexDirection: 'row', gap: space.s8 },
  flex: { flex: 1 },
});
