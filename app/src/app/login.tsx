import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
  const [showPassword, setShowPassword] = useState(false);
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
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: showPassword }}
            style={styles.show}
            hitSlop={8}
          >
            <View style={[styles.box, showPassword && styles.boxOn]}>{showPassword ? <Text style={styles.tick}>✓</Text> : null}</View>
            <Text style={styles.showText}>Показать пароль</Text>
          </Pressable>
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
  show: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, marginTop: -4 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tick: { fontSize: 18, fontWeight: '800' },
  showText: { fontSize: font.body },
  error: { color: colors.danger, fontSize: font.body },
  note: { color: colors.muted, fontSize: font.small, textAlign: 'center' },
  warn: { gap: 16 },
  warnText: { fontSize: font.body },
});
