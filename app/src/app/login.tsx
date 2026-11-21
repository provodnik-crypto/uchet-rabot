import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../components/Text';
import { BigButton } from '../components/BigButton';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { useAuth } from '../lib/auth';
import { humanError } from '../lib/errors';
import { loginError } from '../lib/login';
import { colors, font, radius, size, space, stroke, touch } from '../theme';

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
            hitSlop={space.s8}
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
  logo: { alignItems: 'center', marginTop: touch.min, marginBottom: space.s8, gap: space.s12 },
  badge: { width: size.logo, height: size.logo, borderRadius: radius.round, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: font.sum, fontWeight: '800' },
  title: { fontSize: font.header, fontWeight: '800' },
  form: { gap: space.s16 },
  show: { flexDirection: 'row', alignItems: 'center', gap: space.s12, minHeight: touch.min, marginTop: -space.s4 },
  box: { width: size.check, height: size.check, borderRadius: radius.small, borderWidth: stroke.outline, borderColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tick: { fontSize: font.lead, fontWeight: '800' },
  showText: { fontSize: font.body },
  error: { color: colors.danger, fontSize: font.body },
  note: { color: colors.muted, fontSize: font.small, textAlign: 'center' },
  warn: { gap: space.s16 },
  warnText: { fontSize: font.body },
});
