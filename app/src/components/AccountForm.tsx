import { StyleSheet, View } from 'react-native';
import { generatePassword } from '../lib/password';
import { BigButton } from './BigButton';
import { Field } from './Field';

type Props = {
  login?: { value: string; onChange: (v: string) => void; error?: string | null };
  password: string;
  onPassword: (v: string) => void;
  passwordError?: string | null;
};

/** Поля логина и пароля. Пароль виден: руководитель сообщает его сотруднику. */
export function AccountForm({ login, password, onPassword, passwordError }: Props) {
  return (
    <View style={styles.wrap}>
      {login ? (
        <Field
          label="Логин"
          value={login.value}
          onChangeText={login.onChange}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="например, kolya"
          error={login.error}
          hint="Латинские буквы и цифры, от 3 символов"
        />
      ) : null}
      <Field
        label="Пароль"
        value={password}
        onChangeText={onPassword}
        autoCapitalize="none"
        autoCorrect={false}
        error={passwordError}
        hint="Не меньше 6 символов. Запишите и передайте сотруднику."
      />
      <BigButton title="Придумать пароль" variant="secondary" onPress={() => onPassword(generatePassword())} />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 12 } });
