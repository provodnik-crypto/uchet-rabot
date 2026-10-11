import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AccountForm } from '../../../components/AccountForm';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { adminUsers, initialError, nameError } from '../../../lib/employees';
import { humanError } from '../../../lib/errors';
import { loginError, normalizeLogin } from '../../../lib/login';
import { passwordError } from '../../../lib/password';
import { colors, font } from '../../../theme';

export default function NewEmployeeScreen() {
  const [name, setName] = useState('');
  const [initial, setInitial] = useState('');
  const [role, setRole] = useState<'master' | 'manager'>('master');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
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
        </View>
        <AccountForm
          login={{ value: login, onChange: setLogin, error: errors.login }}
          password={password}
          onPassword={setPassword}
          passwordError={errors.password}
        />
      </Card>
      {serverError ? <Text style={styles.error}>{serverError}</Text> : null}
      <BigButton title="Создать" onPress={save} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  hint: { fontSize: font.small, color: colors.muted },
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  error: { color: colors.danger, fontSize: font.body },
});
