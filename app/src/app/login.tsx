import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { useAuth } from '../lib/auth';
import { humanError } from '../lib/errors';
import { loginError } from '../lib/login';
import { colors, font } from '../theme';

export default function LoginScreen() {
  const { signIn, signOut, accessError } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    const le = loginError(login);
    if (le) return setError(le);
    if (!password) return setError('Введите пароль');
    setError(null);
    setBusy(true);
    try {
      await signIn(login, password);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.logo}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>УР</Text>
        </View>
        <Text style={styles.title}>Учёт работ</Text>
      </View>

      {accessError ? (
        <Card style={styles.warn}>
          <Text style={styles.warnText}>{accessError}</Text>
          <BigButton title="Выйти" variant="secondary" onPress={signOut} />
        </Card>
      ) : (
        <Card style={styles.form}>
          <Field
            label="Логин"
            value={login}
            onChangeText={setLogin}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            placeholder="например, kolya"
          />
          <Field
            ref={passwordRef}
            label="Пароль"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <BigButton title="Войти" onPress={submit} loading={busy} />
          <Text style={styles.note}>Нет логина? Его выдаёт руководитель.</Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { alignItems: 'center', marginTop: 48, marginBottom: 8, gap: 12 },
  badge: { width: 88, height: 88, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 34, fontWeight: '800' },
  title: { fontSize: font.header, fontWeight: '800' },
  form: { gap: 16 },
  error: { color: colors.danger, fontSize: font.body },
  note: { color: colors.muted, fontSize: font.small, textAlign: 'center' },
  warn: { gap: 16 },
  warnText: { fontSize: font.body },
});
