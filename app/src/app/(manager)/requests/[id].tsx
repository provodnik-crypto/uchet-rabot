import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { confirm } from '../../../lib/confirm';
import { humanError } from '../../../lib/errors';
import { updateRequest, type RequestRow } from '../../../lib/manager';
import { assignRequest, formatRegistered, setRequestOpen } from '../../../lib/requests';
import { listMasters } from '../../../lib/shift';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

export default function RequestScreen() {
  const { data } = useLocalSearchParams<{ id: string; data: string }>();
  const r = JSON.parse(data) as RequestRow;
  const { data: masters } = useFocusQuery(listMasters);
  const [subject, setSubject] = useState(r.subject ?? '');
  const [assignee, setAssignee] = useState<number | null>(r.assignee_id);
  const [contractor, setContractor] = useState(r.to_contractor);
  const [open, setOpen] = useState(r.is_open);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const itsm = r.source === 'itsm';

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  const assign = (employeeId: number | null, toContractor: boolean) =>
    run(async () => {
      await assignRequest(r.id, employeeId, toContractor);
      setAssignee(employeeId);
      setContractor(toContractor);
    });

  return (
    <Screen>
      <Text style={styles.number}>{r.number}</Text>
      {itsm ? (
        <Card style={styles.card}>
          <Text style={styles.meta}>{[r.service, r.operation].filter(Boolean).join(' · ')}</Text>
          {r.description ? <Text style={styles.body}>{r.description}</Text> : null}
          <Text style={styles.meta}>
            {formatRegistered(r.registered_at)} · {r.requester ?? 'заявитель не указан'} · {r.itsm_status ?? ''}
          </Text>
          <Text style={[styles.meta, !open && { color: colors.danger, fontWeight: '700' }]}>
            {open ? 'Открыта' : 'Закрыта'} · работ по заявке: {r.entries}
          </Text>
        </Card>
      ) : (
        <Text style={styles.meta}>Введена мастером вручную · работ по заявке: {r.entries}</Text>
      )}

      {itsm && open ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Кому назначена</Text>
          <View style={styles.wrap}>
            <Chip label="Никому" selected={!assignee && !contractor} onPress={() => assign(null, false)} />
            {(masters ?? []).map((m) => (
              <Chip key={m.id} label={m.display_name} selected={assignee === m.id} onPress={() => assign(m.id, false)} />
            ))}
            <Chip label="Подрядчик" selected={contractor} onPress={() => assign(null, true)} />
          </View>
          <Text style={styles.meta}>Назначенную заявку мастер видит первой с пометкой «Назначено вам».</Text>
        </Card>
      ) : null}

      {!itsm ? (
        <Card style={styles.card}>
          <Field label="Тема" value={subject} onChangeText={setSubject} multiline hint="Что нужно сделать. Без имён, фамилий и телефонов." />
          <BigButton
            title="Сохранить"
            loading={busy}
            onPress={() =>
              run(async () => {
                await updateRequest(r.id, { subject: subject.trim() || null });
                router.back();
              })
            }
          />
        </Card>
      ) : null}

      {message ? <Text style={styles.err}>{message}</Text> : null}

      {itsm ? (
        <BigButton
          title={open ? 'Закрыть заявку' : 'Открыть снова'}
          variant={open ? 'danger' : 'secondary'}
          loading={busy}
          onPress={async () => {
            if (open && !(await confirm('Закрыть заявку?', 'Мастера перестанут видеть её в списке.', 'Закрыть'))) return;
            run(async () => {
              await setRequestOpen(r.id, !open);
              setOpen(!open);
            });
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  number: { fontSize: font.title, fontWeight: '800' },
  h: { fontSize: font.body, fontWeight: '800' },
  body: { fontSize: font.body },
  meta: { fontSize: font.small, color: colors.muted },
  card: { gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  err: { color: colors.danger, fontSize: font.body },
});
