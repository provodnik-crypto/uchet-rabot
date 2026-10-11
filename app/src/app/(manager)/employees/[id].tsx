import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { AccountForm } from '../../../components/AccountForm';
import { Avatar } from '../../../components/Avatar';
import { BigButton } from '../../../components/BigButton';
import { Card } from '../../../components/Card';
import { Field } from '../../../components/Field';
import { Screen } from '../../../components/Screen';
import { StateView } from '../../../components/StateView';
import { useAuth } from '../../../lib/auth';
import { adminUsers, getEmployee, renameEmployee, roleLabel } from '../../../lib/employees';
import { humanError } from '../../../lib/errors';
import { loginError, normalizeLogin } from '../../../lib/login';
import { passwordError } from '../../../lib/password';
import { usePhotoUrls } from '../../../lib/photos';
import { useFocusQuery } from '../../../lib/useQuery';
import { colors, font } from '../../../theme';

export default function EmployeeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const employeeId = Number(id);
  const { me } = useAuth();
  const photos = usePhotoUrls();
  const { data: emp, error, loading, reload } = useFocusQuery(() => getEmployee(employeeId));

  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (emp) setName(emp.display_name);
  }, [emp]);

  async function run(key: string, fn: () => Promise<unknown>, okText: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage({ text: okText, ok: true });
      setPassword('');
      await reload();
    } catch (e) {
      setMessage({ text: humanError(e), ok: false });
    } finally {
      setBusy(null);
    }
  }

  if (!emp) {
    return (
      <Screen>
        <StateView loading={loading} error={error} onRetry={reload} />
      </Screen>
    );
  }

  const isSelf = emp.id === me?.id;
  const canLogin = emp.role !== 'service';

  return (
    <Screen>
      <Stack.Screen options={{ title: emp.display_name }} />
      <Card style={styles.card}>
        <Avatar name={emp.display_name} photo={photos[emp.id]} size={96} />
        <Text style={styles.meta}>
          {roleLabel[emp.role]} · {emp.is_active ? 'активен' : 'отключён'}
        </Text>
        <Field label="Имя" value={name} onChangeText={setName} />
        <BigButton
          title="Сохранить имя"
          variant="secondary"
          disabled={!name.trim() || name.trim() === emp.display_name}
          loading={busy === 'name'}
          onPress={() => run('name', () => renameEmployee(emp.id, name), 'Имя сохранено')}
        />
      </Card>

      {canLogin && !emp.has_account ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Создать учётную запись</Text>
          <AccountForm
            login={{ value: login, onChange: setLogin, error: fieldErrors.login }}
            password={password}
            onPassword={setPassword}
            passwordError={fieldErrors.password}
          />
          <BigButton
            title="Создать вход"
            loading={busy === 'create'}
            onPress={() => {
              const e = { login: loginError(login), password: passwordError(password) };
              setFieldErrors(e);
              if (e.login || e.password) return;
              run(
                'create',
                () => adminUsers({ action: 'create', employee_id: emp.id, login: normalizeLogin(login), password }),
                'Учётная запись создана',
              );
            }}
          />
        </Card>
      ) : null}

      {canLogin && emp.has_account ? (
        <Card style={styles.card}>
          <Text style={styles.h}>Логин: {emp.login}</Text>
          <AccountForm password={password} onPassword={setPassword} passwordError={fieldErrors.password} />
          <BigButton
            title="Сменить пароль"
            loading={busy === 'password'}
            onPress={() => {
              const pe = passwordError(password);
              setFieldErrors({ password: pe });
              if (pe) return;
              run('password', () => adminUsers({ action: 'set_password', employee_id: emp.id, password }), 'Пароль изменён');
            }}
          />
        </Card>
      ) : null}

      {message ? <Text style={[styles.msg, { color: message.ok ? colors.success : colors.danger }]}>{message.text}</Text> : null}

      {canLogin && !isSelf ? (
        <BigButton
          title={emp.is_active ? 'Отключить сотрудника' : 'Включить сотрудника'}
          variant={emp.is_active ? 'danger' : 'primary'}
          loading={busy === 'active'}
          onPress={() =>
            run(
              'active',
              () => adminUsers({ action: 'set_active', employee_id: emp.id, active: !emp.is_active }),
              emp.is_active ? 'Сотрудник отключён: войти больше не сможет, история сохранена' : 'Сотрудник включён',
            )
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  meta: { color: colors.muted, fontSize: font.small },
  h: { fontSize: font.body, fontWeight: '700' },
  msg: { fontSize: font.body },
});
