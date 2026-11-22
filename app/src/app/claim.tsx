import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Text, TextInput } from '../components/Text';
import { BigButton } from '../components/BigButton';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../lib/auth';
import { adminUsers } from '../lib/employees';
import { humanError } from '../lib/errors';
import { colors, font, space } from '../theme';

/** Первый вход инициатора: руководитель заранее создал слот (имя, отдел, LDAP), здесь — пароль. */
export default function ClaimScreen() {
  const { signIn } = useAuth();
  const [ldap, setLdap] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const repeatRef = useRef<TextInput>(null);

  async function submit() {
    const code = ldap.trim();
    if (!/^\d{3,20}$/.test(code)) return setError('LDAP: от 3 до 20 цифр — его выдал МВСО');
    if (password.length < 6) return setError('Пароль: не меньше 6 символов');
    if (password !== repeat) return setError('Пароли не совпадают');
    setError(null);
    setBusy(true);
    try {
      await adminUsers({ action: 'claim_initiator', ldap: code, password });
      // учётная запись создана — входим обычным способом (логин = LDAP)
      await signIn(code, password);
      router.replace('/');
    } catch (e) {
      setError(humanError(e));
      setBusy(false);
    }
  }

  return (
    <Screen header={<AppHeader title="Первый вход" back />}>
      <Card style={styles.form}>
        <Text style={styles.note}>
          МВСО заранее записал вас в «Сотрудниках». Введите свой LDAP (личный номер) и придумайте пароль.
        </Text>
        <Field
          label="LDAP"
          value={ldap}
          onChangeText={(v) => setLdap(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          placeholder="например, 4021"
        />
        <Field
          ref={passwordRef}
          label="Придумайте пароль"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => repeatRef.current?.focus()}
        />
        <Field
          ref={repeatRef}
          label="Повторите пароль"
          value={repeat}
          onChangeText={setRepeat}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
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
          <Text style={styles.showText}>{showPassword ? 'Скрыть пароль' : 'Показать пароль'}</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <BigButton title="Создать пароль и войти" onPress={submit} loading={busy} />
        <Text style={styles.hint}>Если LDAP не подходит — попросите МВСО проверить запись в «Сотрудниках».</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.s16 },
  note: { fontSize: font.body, color: colors.muted },
  show: { minHeight: 32, alignSelf: 'flex-start' },
  showText: { fontSize: font.small, color: colors.muted },
  error: { color: colors.danger, fontSize: font.body },
  hint: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
});
