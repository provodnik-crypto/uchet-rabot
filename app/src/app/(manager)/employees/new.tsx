import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import { AccountForm } from '../../../components/AccountForm';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { SelectField } from '../../../components/SelectField';
import { adminUsers, initialError, nameError } from '../../../lib/employees';
import { humanError } from '../../../lib/errors';
import { listDepartments } from '../../../lib/departments';
import { loginError, normalizeLogin } from '../../../lib/login';
import { passwordError } from '../../../lib/password';
import { colors, font, space } from '../../../theme';

type Role = 'master' | 'manager' | 'initiator';

const GRADES = [
  { value: '1', label: 'Сотрудник' },
  { value: '2', label: 'Менеджер отдела' },
  { value: '3', label: 'Руководитель сектора' },
];

export default function NewEmployeeScreen() {
  const [name, setName] = useState('');
  const [initial, setInitial] = useState('');
  const [role, setRole] = useState<Role>('master');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  // поля инициатора
  const [grade, setGrade] = useState('1');
  const [ldap, setLdap] = useState('');
  const [deptId, setDeptId] = useState<number | null>(null);
  const [workPhone, setWorkPhone] = useState('');
  const [depts, setDepts] = useState<{ id: number; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role !== 'initiator') return;
    listDepartments()
      .then((rows) => setDepts(rows.filter((d) => d.is_active !== false).map((d) => ({ id: d.id, name: d.name }))))
      .catch(() => setDepts([]));
  }, [role]);

  async function save() {
    if (role === 'initiator') return saveInitiator();
    const e = {
      name: nameError(name),
      initial: initialError(initial),
      login: loginError(login),
      password: passwordError(password),
    };
    setErrors(e);
    if (e.name || e.initial || e.login || e.password) return;
    setBusy(true);
    setServerError(null);
    try {
      await adminUsers({ action: 'create', first_name: name.trim(), last_initial: initial.trim() || null, role, login: normalizeLogin(login), password });
      router.back();
    } catch (err) {
      setServerError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveInitiator() {
    const e = {
      name: nameError(name),
      initial: initialError(initial),
      ldap: /^\d{3,20}$/.test(ldap.trim()) ? null : 'LDAP: от 3 до 20 цифр',
      dept: deptId ? null : 'Выберите отдел',
      phone:
        Number(grade) >= 2 && !/^031\d{3}$/.test(workPhone.trim())
          ? 'Рабочий телефон 031XXX обязателен'
          : null,
    };
    setErrors(e);
    if (e.name || e.initial || e.ldap || e.dept || e.phone) return;
    setBusy(true);
    setServerError(null);
    try {
      await adminUsers({
        action: 'add_initiator',
        first_name: name.trim(),
        last_initial: initial.trim() || null,
        grade: Number(grade),
        ldap: ldap.trim(),
        department_id: deptId!,
        work_phone: Number(grade) >= 2 ? workPhone.trim() : null,
      });
      router.back();
    } catch (err) {
      setServerError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card style={styles.card}>
        <Field label="Имя" value={name} onChangeText={setName} placeholder="например, Иван" error={errors.name} />
        <Field
          label="Первая буква фамилии"
          value={initial}
          onChangeText={(t) => setInitial(t.slice(-1).toUpperCase())}
          maxLength={1}
          autoCapitalize="characters"
          placeholder="П"
          error={errors.initial}
        />
        <Text style={styles.hint}>В приложении будет «{(name.trim() || 'Иван') + (initial ? ` ${initial}.` : '')}». Полную фамилию не вводите.</Text>
        <Text style={styles.label}>Роль</Text>
        <View style={styles.chips}>
          <Chip label="Мастер" selected={role === 'master'} onPress={() => setRole('master')} />
          <Chip label="Руководитель" selected={role === 'manager'} onPress={() => setRole('manager')} />
          <Chip label="Инициатор" selected={role === 'initiator'} onPress={() => setRole('initiator')} />
        </View>
        {role === 'initiator' ? (
          <>
            <Text style={styles.hint}>
              Инициатор подаёт заявки из магазина (продавцы, менеджеры, руководители секторов). Пароль он придумает сам при первом входе по LDAP.
            </Text>
            <Text style={styles.label}>Кто это</Text>
            <Segmented options={GRADES} value={grade} onChange={setGrade} />
            <SelectField
              label="Отдел"
              value={deptId}
              options={depts.map((d) => ({ value: d.id, label: d.name }))}
              onChange={setDeptId}
              placeholder="Выберите отдел"
              error={errors.dept}
            />
            <Field
              label="LDAP"
              value={ldap}
              onChangeText={(t) => setLdap(t.replace(/\D/g, '').slice(0, 20))}
              keyboardType="number-pad"
              placeholder="личный номер, только цифры"
              error={errors.ldap}
              hint="Инициатор введёт его при первом входе и сам придумает пароль. Передайте номер лично."
            />
            {Number(grade) >= 2 ? (
              <Field
                label="Рабочий телефон"
                value={workPhone}
                onChangeText={(t) => setWorkPhone(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="031XXX"
                error={errors.phone}
                hint="Формат 031XXX — виден руководителю в заявках этого человека."
              />
            ) : (
              <Text style={styles.hint}>Рабочий телефон 031XXX — только менеджеру отдела и руководителю сектора.</Text>
            )}
          </>
        ) : (
          <AccountForm
            login={{ value: login, onChange: setLogin, error: errors.login }}
            password={password}
            onPassword={setPassword}
            passwordError={errors.password}
          />
        )}
      </Card>
      {serverError ? <Text style={styles.error}>{serverError}</Text> : null}
      <BigButton title={role === 'initiator' ? 'Записать инициатора' : 'Создать'} onPress={save} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.s12 },
  hint: { fontSize: font.small, color: colors.muted },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', gap: space.s8, flexWrap: 'wrap' },
  error: { color: colors.danger, fontSize: font.body },
});
