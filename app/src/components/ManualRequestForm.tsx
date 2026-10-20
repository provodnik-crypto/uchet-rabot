import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { humanError } from '../lib/errors';
import { stripContacts } from '../lib/itsm';
import { createManualRequest } from '../lib/requests';
import { listMasters } from '../lib/shift';
import { useFocusQuery } from '../lib/useQuery';
import { colors, font } from '../theme';
import { BigButton } from './BigButton';
import { Card } from './Card';
import { Chip } from './Chip';
import { Field } from './Field';

/**
 * Новая заявка без номера ITSM: номер (1, 2, 3…) выдаёт сервер по порядку.
 * Мастер — заявка сразу «В работе» у него; руководитель — «Ожидает», можно сразу назначить мастеру.
 */
export function ManualRequestForm({ manager, onCreated }: { manager: boolean; onCreated: (r: { id: number; number: string; queued?: boolean }) => void }) {
  const { data: masters } = useFocusQuery(() => (manager ? listMasters() : Promise.resolve([])));
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [assignee, setAssignee] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      // телефоны и почты в тексте заявки не храним
      const r = await createManualRequest(stripContacts(title).trim(), stripContacts(details).trim() || null, assignee);
      onCreated(r);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Field label="Что нужно сделать" value={title} onChangeText={setTitle} placeholder="Например: заменить лампу в торговом зале" maxLength={200} />
      <Field
        label="Где, подробности (необязательно)"
        value={details}
        onChangeText={setDetails}
        multiline
        placeholder="Отдел, ряд, что сломано"
        maxLength={1000}
      />
      {manager ? (
        <>
          <Text style={styles.label}>Назначить сразу (необязательно)</Text>
          <View style={styles.chips}>
            <Chip label="Никому" selected={assignee == null} onPress={() => setAssignee(null)} />
            {(masters ?? []).map((m) => (
              <Chip key={m.id} label={m.display_name} selected={assignee === m.id} onPress={() => setAssignee(m.id)} />
            ))}
          </View>
        </>
      ) : null}
      <Text style={styles.hint}>
        Номер заявки (№ 1, № 2…) присвоится автоматически, по порядку.{' '}
        {manager ? 'Заявка будет «Ожидает» — мастера увидят её в списке.' : 'Заявка сразу станет «В работе» у вас.'} Без имён и телефонов людей.
      </Text>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <BigButton title="Создать заявку" size="big" loading={busy} disabled={title.trim().length < 3} onPress={create} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.secondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hint: { fontSize: font.small - 1, color: colors.muted },
  err: { color: colors.danger, fontSize: font.body },
});
