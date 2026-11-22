import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { Avatar } from '../../components/Avatar';
import { BigButton } from '../../components/BigButton';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { SelectField } from '../../components/SelectField';
import { Text } from '../../components/Text';
import { appVersionLabel } from '../../lib/appUpdate';
import { useAuth } from '../../lib/auth';
import { listDepartments } from '../../lib/departments';
import { humanError } from '../../lib/errors';
import { initiatorProfile, setMyDepartment, setMyMobile, type InitiatorProfileInfo } from '../../lib/initiators';
import { useFocusQuery } from '../../lib/useQuery';
import { colors, font, space, touch } from '../../theme';

const GRADE_LABEL: Record<number, string> = { 1: 'Сотрудник', 2: 'Менеджер отдела', 3: 'Руководитель сектора' };

/** Профиль инициатора — по образцу профиля мастера: кто я, мой отдел, мобильный, выход. */
export default function InitiatorProfile() {
  const { me, signOut } = useAuth();
  const q = useFocusQuery(initiatorProfile, { key: 'init:profile' });
  const deptsQ = useFocusQuery(listDepartments, { key: 'init:departments' });
  const profile: InitiatorProfileInfo | null = q.data ?? null;
  const [deptId, setDeptId] = useState<number | null>(null);
  const [mobile, setMobile] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDeptId(profile.department_id ?? null);
    setMobile(profile.mobile ?? '');
  }, [profile]);

  const depts = deptsQ.data ?? [];

  async function save() {
    if (!deptId) {
      setError('Выберите отдел');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (deptId !== (profile?.department_id ?? null)) await setMyDepartment(deptId);
      if ((mobile.trim() || null) !== (profile?.mobile ?? null)) await setMyMobile(mobile.trim() || null);
      setSaved(true);
      await q.reload();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen
      header={<AppHeader title="Профиль" back />}
      footer={<BigButton title={saving ? 'Сохраняю…' : 'Сохранить'} onPress={save} loading={saving} disabled={saving} />}
    >
      <Section>
        <View style={styles.row}>
          {me ? <Avatar name={me.displayName} size={touch.big} dark /> : null}
          <View style={styles.flex}>
            <Text style={styles.name}>{me?.displayName ?? profile?.display_name}</Text>
            <Text style={styles.meta}>
              Инициатор{profile?.grade ? ` · ${GRADE_LABEL[profile.grade]}` : ''} · {me?.login}
            </Text>
          </View>
        </View>
      </Section>

      <Card>
        <SelectField
          label="Мой отдел"
          value={deptId}
          options={depts.filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.name }))}
          onChange={setDeptId}
          placeholder="Выберите отдел"
        />
        <Field
          label="Мой мобильный"
          value={mobile}
          onChangeText={(t) => {
            setMobile(t);
            setSaved(false);
          }}
          keyboardType="phone-pad"
          placeholder="+7…"
          hint="Видит только МВСО. Рабочие телефоны 031XXX вписывает МВСО."
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {saved ? <Text style={styles.meta}>Сохранено.</Text> : null}
      </Card>

      <BigButton title="Выйти" variant="secondary" onPress={signOut} />
      <Text style={styles.version}>{appVersionLabel()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s12 },
  flex: { flex: 1, gap: space.s2 },
  name: { fontSize: font.header, fontWeight: '700' },
  meta: { fontSize: font.small, color: colors.secondary },
  error: { fontSize: font.small, color: colors.danger, marginTop: space.s2 },
  version: { fontSize: font.caption, color: colors.muted, textAlign: 'center' },
});
