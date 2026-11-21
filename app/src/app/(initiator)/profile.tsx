import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { Screen, useScreenRefresh } from '../../components/Screen';
import { SelectField } from '../../components/SelectField';
import { Text } from '../../components/Text';
import { useAuth } from '../../lib/auth';
import { humanError } from '../../lib/errors';
import { initiatorProfile, setMyDepartment, setMyMobile, type InitiatorProfileInfo } from '../../lib/initiators';
import { listDepartments } from '../../lib/departments';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font, space } from '../../theme';

const GRADE_LABEL: Record<number, string> = { 1: 'Сотрудник', 2: 'Менеджер отдела', 3: 'Руководитель сектора' };

/** Профиль инициатора: отдел (можно сменить/создать), свой мобильный, выход. */
export default function InitiatorProfileScreen() {
  const { signOut } = useAuth();
  const q = useFocusQuery(initiatorProfile, { key: 'init:profile', persist: false });
  useScreenRefresh(q.reload);
  const deptQ = useFocusQuery(listDepartments, { key: 'init:departments' });
  const [me, setMe] = useState<InitiatorProfileInfo | null>(null);
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.data) {
      setMe(q.data);
      setMobile(q.data.mobile ?? '');
    }
  }, [q.data]);

  const departments = deptQ.data ?? [];
  const deptOptions = departments.filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.name }));

  async function save(deptId?: number) {
    setError(null);
    setBusy(true);
    try {
      if (deptId && deptId !== me?.department_id) {
        await setMyDepartment(deptId);
        if (me) setMe({ ...me, department_id: deptId, department_name: departments.find((d) => d.id === deptId)?.name ?? null });
      }
      const m = mobile.trim() || null;
      if (m !== (me?.mobile ?? null)) {
        await setMyMobile(m);
        if (me) setMe({ ...me, mobile: m });
      }
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<AppHeader title="Профиль" back />} status={q} footer={undefined}>
      <Card style={styles.card}>
        <Text style={styles.name}>{me?.display_name ?? '…'}</Text>
        {me?.grade ? <Text style={styles.grade}>{GRADE_LABEL[me.grade] ?? ''}</Text> : null}
        {me?.work_phone ? <Text style={styles.grade}>Рабочий: {me.work_phone}</Text> : null}

        <SelectField
          label="Мой отдел"
          value={me?.department_id ?? null}
          options={deptOptions}
          onChange={(id) => save(id)}
          placeholder="Выберите отдел"
        />
        <Text style={styles.note}>Своего отдела нет в списке? Добавить его можно при создании заявки.</Text>

        <Field
          label="Мой мобильный"
          value={mobile}
          onChangeText={setMobile}
          keyboardType="phone-pad"
          placeholder="+7 9xx xxx-xx-xx"
          hint="Видит только руководитель. Рабочие телефоны 031XXX вписывает руководитель."
        />
        <BigButton title="Сохранить" onPress={() => save()} loading={busy} disabled={busy} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
      <BigButton title="Выйти" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s12 },
  name: { fontSize: font.lead, fontWeight: '700' },
  grade: { fontSize: font.small, color: colors.muted, marginTop: -space.s8 },
  row: { gap: space.s8 },
  note: { fontSize: font.small, color: colors.muted },
  error: { color: colors.danger, fontSize: font.body },
});
