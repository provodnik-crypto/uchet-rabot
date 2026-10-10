import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AccountForm } from '../../../components/AccountForm';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { adminUsers } from '../../../lib/employees';
import { humanError } from '../../../lib/errors';
import { loginError, normalizeLogin } from '../../../lib/login';
import { passwordError } from '../../../lib/password';
import { colors, font } from '../../../theme';

export default function NewEmployeeScreen() {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'master' | 'manager'>('master');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const e = {
      name: name.trim() ? null : 'Введите имя',
      login: loginError(login),
      password: passwordError(password),
    };
    setErrors(e);
    if (e.name || e.login || e.password) return;
    setBusy(true);
    setServerError(null);
    try {
      await adminUsers({ action: 'create', display_name: name.trim(), role, login: normalizeLogin(login), password });
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
        <Field label="Имя (как в отчётах)" value={name} onChangeText={setName} placeholder="например, Коля" error={errors.name} />
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
  label: { fontSize: font.small, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  error: { color: colors.danger, fontSize: font.body },
});
